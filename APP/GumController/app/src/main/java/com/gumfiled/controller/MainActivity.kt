package com.gumfiled.controller

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.KeyEvent
import android.view.View
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import com.gumfiled.controller.databinding.ActivityMainBinding
import com.gumfiled.controller.net.JoinInfo
import com.gumfiled.controller.net.Packet
import com.gumfiled.controller.net.WsClient
import com.gumfiled.controller.sensor.SensorSampler
import com.gumfiled.controller.sensor.SensorStreamer
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import java.util.Locale

/**
 * 화면 흐름 (README 시퀀스 다이어그램 기준)
 *   CONNECT ──JOIN_SUCCESS──▶ WAITING ──GAME_START──▶ CALIBRATION ──확인──▶ PLAYING
 * 영점 화면부터 SENSOR 패킷을 계속 보낸다 (규격 19~20번).
 */
class MainActivity : AppCompatActivity(), WsClient.Listener {

    private enum class Screen { CONNECT, WAITING, CALIBRATION, PLAYING }

    private lateinit var binding: ActivityMainBinding
    private lateinit var sampler: SensorSampler
    private lateinit var streamer: SensorStreamer

    private var screen = Screen.CONNECT
    private var ws: WsClient? = null
    private var playerId: String? = null
    private var pendingPin: String? = null
    private var testMode = false

    // 볼륨 키 상태. 센서 전송 스레드에서 읽으므로 @Volatile
    @Volatile private var volumeUpHeld = false
    @Volatile private var volumeDownHeld = false

    private val ui = Handler(Looper.getMainLooper())
    private val refreshTask = object : Runnable {
        override fun run() {
            refreshSensorText()
            ui.postDelayed(this, 100)
        }
    }

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let { onQrScanned(it) }
    }

    // ------------------------------------------------------------------ 생명주기

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sampler = SensorSampler(this)
        streamer = SensorStreamer(sampler)

        binding.etServer.setText(prefs().getString(PREF_SERVER, ""))
        sampler.missingSensors().takeIf { it.isNotEmpty() }?.let {
            binding.tvSensorWarning.text = "이 기기에 없는 센서: ${it.joinToString()}\n게임 플레이가 불가능할 수 있습니다."
            binding.tvSensorWarning.visibility = View.VISIBLE
        }

        binding.btnScan.setOnClickListener { startQrScan() }
        binding.btnJoin.setOnClickListener {
            join(binding.etServer.text.toString(), binding.etPin.text.toString())
        }
        binding.btnSensorTest.setOnClickListener { startSensorTest() }
        binding.btnConfirm.setOnClickListener { confirmCalibration() }
        binding.btnLeaveWaiting.setOnClickListener { leave("나갔습니다") }
        binding.btnLeavePlaying.setOnClickListener { leave("나갔습니다") }

        onBackPressedDispatcher.addCallback(this) {
            if (screen == Screen.CONNECT) {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            } else {
                leave("나갔습니다")
            }
        }

        show(Screen.CONNECT)
    }

    override fun onResume() {
        super.onResume()
        sampler.start()
        ui.post(refreshTask)
    }

    override fun onPause() {
        super.onPause()
        sampler.stop()
        ui.removeCallbacks(refreshTask)
    }

    override fun onDestroy() {
        streamer.stop()
        ws?.close()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ 연결

    private fun startQrScan() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("PC 화면의 QR 코드를 비춰주세요")
            setBeepEnabled(false)
            setOrientationLocked(false)
        }
        scanLauncher.launch(options)
    }

    private fun onQrScanned(raw: String) {
        Log.i(TAG, "QR: $raw")
        val info = JoinInfo.parseQr(raw)
        info.serverUrl?.let { binding.etServer.setText(it) }
        info.pin?.let { binding.etPin.setText(it) }
        if (info.serverUrl != null && info.pin != null) {
            join(info.serverUrl, info.pin)
        } else {
            setStatus("QR을 읽었지만 정보가 부족합니다: $raw")
        }
    }

    private fun join(serverInput: String, pinInput: String) {
        val url = JoinInfo.normalizeServer(serverInput)
        val pin = pinInput.trim()
        if (url == null) { setStatus("서버 주소를 입력하세요"); return }
        if (pin.isEmpty()) { setStatus("PIN을 입력하세요"); return }

        prefs().edit().putString(PREF_SERVER, serverInput.trim()).apply()
        ws?.close()
        pendingPin = pin
        setStatus("연결 중... $url")
        binding.btnJoin.isEnabled = false
        ws = WsClient(url, this).also { it.connect() }
    }

    override fun onOpen() {
        val pin = pendingPin ?: return
        ws?.send(Packet.joinRoom(pin))
        setStatus("입장 요청 보냄 (PIN $pin)")
    }

    override fun onMessage(json: JSONObject) {
        val type = json.optString("type")
        Log.d(TAG, "수신: $json")
        when (type) {
            Packet.JOIN_SUCCESS -> {
                playerId = json.optString("assigned_id").ifEmpty { "PLAYER_?" }
                binding.tvWaitingNote.text = ""
                show(Screen.WAITING)
                vibrate(60)
            }
            Packet.GAME_START -> startCalibration()

            // 11/26 WebRTC 단계에서 처리. 지금은 서버가 보내도 무시하고 WebSocket으로 계속 보낸다
            Packet.WEBRTC_OFFER, Packet.WEBRTC_ICE_CANDIDATE -> {
                binding.tvWaitingNote.text = "WebRTC 요청을 받았지만 아직 미구현입니다.\n(WebSocket으로 데이터 전송)"
            }

            else -> {
                // 규격에 실패 응답이 정의되지 않아서, 서버가 무엇을 보내든 화면에 띄워둔다
                val msg = json.optString("message").ifEmpty { json.toString() }
                if (screen == Screen.CONNECT) {
                    setStatus("서버 응답: $msg")
                    binding.btnJoin.isEnabled = true
                }
                Log.w(TAG, "처리하지 않은 메시지: $json")
            }
        }
    }

    override fun onDisconnected(reason: String) {
        leave("연결 끊김: $reason")
    }

    private fun leave(status: String) {
        streamer.stop()
        ws?.close()
        ws = null
        playerId = null
        testMode = false
        volumeUpHeld = false
        volumeDownHeld = false
        show(Screen.CONNECT)
        setStatus(status)
    }

    // ------------------------------------------------------------------ 게임

    private fun startCalibration() {
        val id = playerId ?: return
        show(Screen.CALIBRATION)
        vibrate(120)
        streamer.start(id, if (testMode) null else ws) { currentButton() }
    }

    private fun confirmCalibration() {
        val id = playerId ?: return
        if (!testMode) ws?.send(Packet.calibrateConfirm(id))
        vibrate(60)
        show(Screen.PLAYING)
    }

    /** 서버 없이 센서값과 전송 빈도만 확인하는 모드 */
    private fun startSensorTest() {
        ws?.close()
        ws = null
        testMode = true
        playerId = "TEST"
        startCalibration()
    }

    /**
     * 규격: 0 입력 없음, 1 볼륨 상(방어), 2 볼륨 하(강타 충전)
     * 둘 다 누르면 방어 우선 (규격 미정 → 팀 확인 필요)
     */
    private fun currentButton(): Int = when {
        volumeUpHeld -> 1
        volumeDownHeld -> 2
        else -> 0
    }

    private fun gameScreen() = screen == Screen.CALIBRATION || screen == Screen.PLAYING

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (gameScreen()) {
            when (keyCode) {
                // true를 돌려줘야 실제 볼륨이 바뀌지 않는다
                KeyEvent.KEYCODE_VOLUME_UP -> { volumeUpHeld = true; return true }
                KeyEvent.KEYCODE_VOLUME_DOWN -> { volumeDownHeld = true; return true }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (gameScreen()) {
            when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> { volumeUpHeld = false; return true }
                KeyEvent.KEYCODE_VOLUME_DOWN -> { volumeDownHeld = false; return true }
            }
        }
        return super.onKeyUp(keyCode, event)
    }

    // ------------------------------------------------------------------ 화면

    private fun show(target: Screen) {
        screen = target
        binding.panelConnect.visibility = if (target == Screen.CONNECT) View.VISIBLE else View.GONE
        binding.panelWaiting.visibility = if (target == Screen.WAITING) View.VISIBLE else View.GONE
        binding.panelCalibration.visibility = if (target == Screen.CALIBRATION) View.VISIBLE else View.GONE
        binding.panelPlaying.visibility = if (target == Screen.PLAYING) View.VISIBLE else View.GONE
        binding.btnJoin.isEnabled = target == Screen.CONNECT

        val label = if (testMode) "센서 테스트 모드 (전송 안 함)" else playerId.orEmpty()
        binding.tvWaitingPlayer.text = playerId.orEmpty()
        binding.tvCalibPlayer.text = label
        binding.tvPlayPlayer.text = label
    }

    private fun setStatus(text: String) {
        binding.tvConnectStatus.text = text
    }

    private fun refreshSensorText() {
        if (!gameScreen()) return
        val s = sampler.snapshot()
        val q = s.rotation
        val a = s.acceleration
        val g = s.angularVelocity
        val text = String.format(
            Locale.US,
            "rot  w=%6.3f x=%6.3f y=%6.3f z=%6.3f\n" +
                "acc  x=%6.2f y=%6.2f z=%6.2f  m/s²\n" +
                "gyro x=%6.2f y=%6.2f z=%6.2f  rad/s\n" +
                "센서 수신 %d/s · 패킷 %s %d/s",
            q[0], q[1], q[2], q[3], a[0], a[1], a[2], g[0], g[1], g[2],
            sampler.rotationRate, if (testMode) "생성" else "전송", streamer.sentPerSecond
        )
        binding.tvSensor.text = text
        binding.tvCalibSensor.text = text
        binding.tvButtonState.text = when (currentButton()) {
            1 -> "방어"
            2 -> "강타 충전"
            else -> "대기"
        }
    }

    private fun vibrate(ms: Long) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun prefs() = getSharedPreferences("gum_controller", Context.MODE_PRIVATE)

    companion object {
        private const val TAG = "GumController"
        private const val PREF_SERVER = "server"
    }
}
