package com.gumfiled.controller

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import com.gumfiled.controller.databinding.ActivityMainBinding
import com.gumfiled.controller.net.JoinInfo
import com.gumfiled.controller.net.Packet
import com.gumfiled.controller.net.RtcClient
import com.gumfiled.controller.net.WsClient
import com.gumfiled.controller.sensor.SensorSampler
import com.gumfiled.controller.sensor.SensorStreamer
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import java.util.Locale

/**
 * 화면 흐름
 *   CONNECT ──JOIN_SUCCESS──▶ WAITING ──GAME_START──▶ PLAYING
 * 영점은 PC에서 처리하므로 앱에는 영점 화면이 없다.
 * GAME_START 이후 SENSOR 패킷을 계속 보낸다.
 *
 * 전송 방식은 서버가 JOIN_SUCCESS.transport로 알려준다.
 *  - relay: 입장, GAME_START, SENSOR 모두 WebSocket(서버 경유)
 *  - p2p:   입장과 WebRTC 시그널링은 WebSocket, GAME_START와 SENSOR는 WebRTC DataChannel(PC와 직접)
 */
class MainActivity : AppCompatActivity(), WsClient.Listener, RtcClient.Listener {

    private enum class Screen { CONNECT, WAITING, PLAYING }

    private lateinit var binding: ActivityMainBinding
    private lateinit var sampler: SensorSampler
    private lateinit var streamer: SensorStreamer

    private var screen = Screen.CONNECT
    // WebRTC 스레드에서도 읽으므로 @Volatile
    @Volatile private var ws: WsClient? = null
    private var rtc: RtcClient? = null
    private var transportMode = Packet.TRANSPORT_RELAY
    private var iceServers: List<String> = emptyList()
    private var playerId: String? = null
    private var lastErrorToastMs = 0L
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
        binding.btnJoin.setOnClickListener { joinFromInput() }
        // 키패드의 '이동' 키로도 입장
        binding.etPin.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) { joinFromInput(); true } else false
        }
        binding.btnSensorTest.setOnClickListener { hideKeyboard(); startSensorTest() }
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
        rtc?.close()
        ws?.close()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ 연결

    private fun joinFromInput() {
        hideKeyboard()
        join(binding.etServer.text.toString(), binding.etPin.text.toString())
    }

    /** 입장 버튼을 눌러도 키패드가 남아 화면을 가리던 문제 → 포커스를 빼고 키패드를 내린다 */
    private fun hideKeyboard() {
        val focused = currentFocus ?: binding.root
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(focused.windowToken, 0)
        focused.clearFocus()
    }

    private fun startQrScan() {
        hideKeyboard()
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
        rtc?.close()
        rtc = null
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

    /** 서버(WebSocket)에서 온 메시지 */
    override fun onMessage(json: JSONObject) {
        val type = json.optString("type")
        if (type != Packet.WEBRTC_ICE_CANDIDATE) Log.d(TAG, "WS 수신: $json")
        when (type) {
            Packet.JOIN_SUCCESS -> onJoined(json)
            Packet.GAME_START -> startGame() // relay 모드에서만 이 경로로 온다
            Packet.WEBRTC_OFFER -> onOffer(json)
            Packet.WEBRTC_ICE_CANDIDATE -> rtc?.handleRemoteCandidate(json.optJSONObject("candidate"))
            Packet.ERROR -> onServerError(json)
            Packet.ROOM_CLOSED -> leave("PC가 방을 닫았습니다")
            else -> Log.w(TAG, "처리하지 않은 메시지: $json")
        }
    }

    private fun onJoined(json: JSONObject) {
        playerId = json.optString("assigned_id").ifEmpty { "PLAYER_?" }
        transportMode = json.optString("transport", Packet.TRANSPORT_RELAY)
        iceServers = RtcClient.parseIceServers(json)
        streamer.resetSequence()
        binding.tvWaitingNote.text =
            if (isP2p()) "PC와 직접 연결(WebRTC) 준비 중..." else "서버 중계(relay) 모드"
        show(Screen.WAITING)
        vibrate(60)
    }

    /** p2p: 입장 직후 PC가 보내는 Offer로 WebRTC 연결을 시작한다 */
    private fun onOffer(json: JSONObject) {
        if (!isP2p()) {
            Log.w(TAG, "relay 모드인데 Offer를 받음 → 무시")
            return
        }
        val sdp = json.optString("sdp")
        if (sdp.isEmpty()) return
        rtc?.close()
        rtc = try {
            // 시그널링(Answer, ICE)은 WebSocket으로 서버를 거쳐 PC에 전달된다
            RtcClient(this, iceServers, { message -> ws?.send(message) }, this).also { it.handleOffer(sdp) }
        } catch (e: Exception) {
            Log.e(TAG, "WebRTC 초기화 실패", e)
            leave("직접 연결 준비 실패: ${e.message}")
            return
        }
        binding.tvWaitingNote.text = "PC와 직접 연결 중..."
    }

    /** 서버 ERROR: {"type":"ERROR","code":"INVALID_PIN","message":"..."} */
    private fun onServerError(json: JSONObject) {
        val code = json.optString("code")
        val msg = json.optString("message").ifEmpty { code }
        Log.w(TAG, "서버 오류 $code: $msg")
        if (playerId == null) {
            // 입장 단계 오류 (INVALID_PIN, ROOM_FULL 등). 연결을 정리하고 다시 시도할 수 있게 한다
            leave("입장 실패: $msg ($code)")
            return
        }
        // 게임 중 오류는 화면을 유지하고 알림만. 같은 오류가 연달아 와도 3초에 한 번만 띄운다
        val now = SystemClock.elapsedRealtime()
        if (now - lastErrorToastMs > 3000) {
            lastErrorToastMs = now
            Toast.makeText(this, "서버 오류: $msg", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDisconnected(reason: String) {
        leave("연결 끊김: $reason")
    }

    // ---- WebRTC 콜백 (메인 스레드)

    override fun onChannelOpen() {
        binding.tvWaitingNote.text = "PC와 직접 연결됨 (WebRTC)"
        vibrate(40)
    }

    /** DataChannel로 온 메시지. p2p 모드의 GAME_START는 여기로 온다 */
    override fun onChannelMessage(json: JSONObject) {
        Log.d(TAG, "DataChannel 수신: $json")
        when (json.optString("type")) {
            Packet.GAME_START -> startGame()
            else -> Log.w(TAG, "처리하지 않은 DataChannel 메시지: $json")
        }
    }

    override fun onRtcFailed(reason: String) {
        rtc = null
        leave("직접 연결 실패: $reason\n다시 입장하거나, 서버를 TRANSPORT=relay로 실행하세요")
    }

    private fun isP2p() = transportMode == Packet.TRANSPORT_P2P

    private fun leave(status: String) {
        streamer.stop()
        rtc?.close()
        rtc = null
        ws?.close()
        ws = null
        playerId = null
        transportMode = Packet.TRANSPORT_RELAY
        iceServers = emptyList()
        testMode = false
        volumeUpHeld = false
        volumeDownHeld = false
        show(Screen.CONNECT)
        setStatus(status)
    }

    // ------------------------------------------------------------------ 게임

    private fun startGame() {
        val id = playerId ?: return
        val transport = when {
            testMode -> null
            isP2p() -> rtc
            else -> ws
        }
        if (!testMode && transport == null) {
            Log.w(TAG, "전송 통로가 없음 (p2p 연결 전)")
        }
        show(Screen.PLAYING)
        vibrate(120)
        streamer.start(id, transport) { currentButton() }
    }

    /** 서버 없이 센서값과 전송 빈도만 확인하는 모드 */
    private fun startSensorTest() {
        ws?.close()
        ws = null
        testMode = true
        playerId = "TEST"
        startGame()
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

    private fun gameScreen() = screen == Screen.PLAYING

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
        binding.panelPlaying.visibility = if (target == Screen.PLAYING) View.VISIBLE else View.GONE
        binding.btnJoin.isEnabled = target == Screen.CONNECT

        val label = when {
            testMode -> "센서 테스트 모드 (전송 안 함)"
            playerId == null -> ""
            else -> "$playerId · ${if (isP2p()) "직접 연결" else "서버 중계"}"
        }
        binding.tvWaitingPlayer.text = playerId.orEmpty()
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
