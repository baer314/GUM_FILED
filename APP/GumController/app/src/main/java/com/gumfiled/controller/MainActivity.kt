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
import androidx.core.content.ContextCompat
import com.gumfiled.controller.databinding.ActivityMainBinding
import com.gumfiled.controller.net.JoinInfo
import com.gumfiled.controller.net.Packet
import com.gumfiled.controller.net.RtcClient
import com.gumfiled.controller.net.WsClient
import com.gumfiled.controller.sensor.SensorSampler
import com.gumfiled.controller.sensor.SensorStreamer
import com.gumfiled.controller.ui.GumArt
import com.gumfiled.controller.ui.OrbView
import com.gumfiled.controller.ui.SpaceBackgroundView
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import java.util.Locale

/**
 * 화면 흐름
 *   CONNECT ──JOIN_SUCCESS──▶ WAITING ──GAME_START──▶ PLAYING
 * 영점은 PC에서 처리하므로 앱에는 영점 화면이 없다. 게임 중 볼륨 상을 누르면 PC가 검을 다시 정렬한다.
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
     * 키 배치: 볼륨 하 = 방어(1), 볼륨 상 = 검 정렬(2). 값의 의미는 Packet.BUTTON_* 참고.
     * 둘 다 누르면 방어 우선 (정렬 중에 막지 못하면 위험하므로)
     */
    private fun currentButton(): Int = when {
        volumeDownHeld -> Packet.BUTTON_DEFEND
        volumeUpHeld -> Packet.BUTTON_ALIGN
        else -> Packet.BUTTON_NONE
    }

    private fun gameScreen() = screen == Screen.PLAYING

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (gameScreen()) {
            when (keyCode) {
                // true를 돌려줘야 실제 볼륨이 바뀌지 않는다
                KeyEvent.KEYCODE_VOLUME_UP -> {
                    if (event.repeatCount == 0) vibrate(30) // 검 정렬 확인용
                    volumeUpHeld = true
                    renderButtonState()
                    return true
                }
                KeyEvent.KEYCODE_VOLUME_DOWN -> { volumeDownHeld = true; renderButtonState(); return true }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (gameScreen()) {
            when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> { volumeUpHeld = false; renderButtonState(); return true }
                KeyEvent.KEYCODE_VOLUME_DOWN -> { volumeDownHeld = false; renderButtonState(); return true }
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

        // 플레이어 색: 1P 민트, 2P 피치 (PC 화면과 같다)
        val p2 = isPlayer2()
        val pillText = if (testMode) "TEST" else playerId.orEmpty().replace('_', ' ')
        for (pill in listOf(binding.tvWaitingPlayer, binding.tvPlayPlayer)) {
            pill.text = pillText
            pill.setBackgroundResource(if (p2) R.drawable.bg_pill_p2 else R.drawable.bg_pill_p1)
            pill.setTextColor(color(if (p2) R.color.gum_p2_label else R.color.gum_p1))
        }
        binding.spaceBg.setScene(
            when (target) {
                Screen.CONNECT -> SpaceBackgroundView.Scene.CONNECT
                Screen.WAITING -> SpaceBackgroundView.Scene.WAITING
                Screen.PLAYING -> SpaceBackgroundView.Scene.PLAYING
            },
            player2 = p2,
            hiltColor = myColor(),
        )
        binding.orbLogo.mode = OrbView.Mode.LOGO
        binding.orbWaiting.mode = OrbView.Mode.WAITING
        binding.orbWaiting.myColor = myColor()
        binding.orbPlay.myColor = myColor()
        binding.orbPlay.foeColor = if (p2) GumArt.P1 else GumArt.P2
        binding.tvSensor.visibility = if (testMode) View.VISIBLE else View.GONE
        renderButtonState()
    }

    private fun isPlayer2() = playerId == "PLAYER_2"

    private fun myColor() = if (isPlayer2()) GumArt.P2 else GumArt.P1

    private fun color(id: Int) = ContextCompat.getColor(this, id)

    /** 게임 화면 가운데 그림, 상태 글자, 키 안내 칩을 현재 버튼에 맞춘다 */
    private fun renderButtonState() {
        if (!gameScreen()) return
        val button = currentButton()
        val (mode, text, hint) = when (button) {
            Packet.BUTTON_DEFEND -> Triple(OrbView.Mode.DEFEND, R.string.state_defend, R.string.state_defend_hint)
            Packet.BUTTON_ALIGN -> Triple(OrbView.Mode.ALIGN, R.string.state_align, R.string.state_align_hint)
            else -> Triple(OrbView.Mode.IDLE, R.string.state_idle, R.string.state_idle_hint)
        }
        binding.orbPlay.mode = mode
        binding.tvButtonState.setText(text)
        binding.tvStateHint.setText(hint)
        binding.tvButtonState.setTextColor(
            when (button) {
                Packet.BUTTON_DEFEND -> myColor()
                Packet.BUTTON_ALIGN -> GumArt.GOLD
                else -> color(R.color.gum_text)
            }
        )
        binding.chipAlign.setBackgroundResource(
            if (button == Packet.BUTTON_ALIGN) R.drawable.bg_key_on_gold else R.drawable.bg_key
        )
        binding.chipDefend.setBackgroundResource(
            when {
                button != Packet.BUTTON_DEFEND -> R.drawable.bg_key
                isPlayer2() -> R.drawable.bg_key_on_p2
                else -> R.drawable.bg_key_on_p1
            }
        )
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
        binding.tvRotX.text = String.format(Locale.US, "x\n%.2f", q[1])
        binding.tvRotY.text = String.format(Locale.US, "y\n%.2f", q[2])
        binding.tvRotZ.text = String.format(Locale.US, "z\n%.2f", q[3])
        binding.tvRotW.text = String.format(Locale.US, "w\n%.2f", q[0])
        binding.tvLink.text = when {
            testMode -> "센서 테스트 · 생성 ${streamer.sentPerSecond}/s"
            isP2p() -> "직접 연결 · ${streamer.sentPerSecond}/s"
            else -> "서버 중계 · ${streamer.sentPerSecond}/s"
        }
        renderButtonState()
        if (!testMode) return
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
