package com.gumfield.controller.net

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.gumfield.controller.Config
import org.json.JSONException
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets

/**
 * PC와의 WebRTC 직접 연결 (서버 transport = "p2p").
 *
 * 흐름 (PC/network.js 기준)
 *  1. 앱이 입장하면 PC가 "game" DataChannel을 만들고 WEBRTC_OFFER를 보낸다 (서버 경유)
 *  2. 앱: Offer 적용 → Answer 생성 → WEBRTC_ANSWER 전송
 *  3. 양쪽이 WEBRTC_ICE_CANDIDATE를 주고받는다 (서버 경유)
 *  4. DataChannel이 열리면 GAME_START를 이 채널로 받고, SENSOR를 이 채널로 보낸다
 *
 * 시그널링 메시지는 [signal]로 WebSocket에 보낸다.
 * Listener 콜백은 전부 메인(UI) 스레드에서 호출된다.
 */
class RtcClient(
    context: Context,
    iceServerUrls: List<String>,
    private val signal: (String) -> Unit,
    private val listener: Listener,
) : Transport {

    interface Listener {
        /** DataChannel이 열림. 이제 SENSOR를 보낼 수 있다 */
        fun onChannelOpen()
        /** DataChannel로 받은 메시지 (GAME_START 등) */
        fun onChannelMessage(json: JSONObject)
        /** 연결 실패 또는 끊김. close()로 직접 닫은 경우에는 호출되지 않는다 */
        fun onRtcFailed(reason: String)
    }

    private val main = Handler(Looper.getMainLooper())
    private val pc: PeerConnection
    @Volatile private var channel: DataChannel? = null
    @Volatile private var closed = false
    private var failed = false

    /** Offer 적용 전에 도착한 PC의 ICE 후보. setRemoteDescription 성공 후 추가한다 */
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private var remoteDescriptionSet = false

    private val timeout = Runnable { fail("${Config.P2P_CONNECT_TIMEOUT_MS / 1000}초 안에 직접 연결되지 않았습니다") }

    // WebRTC 콜백 (WebRTC 내부 스레드에서 호출됨)
    // init에서 createPeerConnection에 넘기므로 반드시 init보다 위에 선언해야 한다

    private val observer = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate?) {
            if (candidate == null || closed) return
            signal(Packet.webrtcIceCandidate(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex))
        }

        override fun onDataChannel(dc: DataChannel?) {
            if (dc == null || closed) return
            if (dc.label() != CHANNEL_LABEL) {
                Log.w(TAG, "알 수 없는 DataChannel 무시: ${dc.label()}")
                return
            }
            channel = dc
            dc.registerObserver(channelObserver(dc))
            // 등록하기 전에 이미 열렸을 수 있다
            if (dc.state() == DataChannel.State.OPEN) onOpen()
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
            Log.d(TAG, "연결 상태: $newState")
            when (newState) {
                PeerConnection.PeerConnectionState.FAILED -> fail("직접 연결에 실패했습니다 (네트워크가 기기 간 연결을 막고 있을 수 있음)")
                PeerConnection.PeerConnectionState.CLOSED -> fail("직접 연결이 닫혔습니다")
                else -> Unit // DISCONNECTED는 잠깐 끊겼다 복구되기도 해서 기다린다
            }
        }

        override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            Log.d(TAG, "ICE 상태: $state")
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
        override fun onAddStream(stream: MediaStream?) = Unit
        override fun onRemoveStream(stream: MediaStream?) = Unit
        override fun onRenegotiationNeeded() = Unit
    }

    init {
        val factory = factory(context.applicationContext)
        val servers = iceServerUrls.map { PeerConnection.IceServer.builder(it).createIceServer() }
        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        pc = factory.createPeerConnection(config, observer)
            ?: throw IllegalStateException("PeerConnection을 만들 수 없습니다")
        main.postDelayed(timeout, Config.P2P_CONNECT_TIMEOUT_MS)
    }

    // ------------------------------------------------------------------ 시그널링 (메인 스레드에서 호출)

    /** WEBRTC_OFFER 수신 */
    fun handleOffer(sdp: String) {
        if (closed) return
        pc.setRemoteDescription(object : SimpleSdpObserver("Offer 적용") {
            override fun onSetSuccess() {
                main.post {
                    if (closed) return@post
                    remoteDescriptionSet = true
                    pendingCandidates.forEach { pc.addIceCandidate(it) }
                    pendingCandidates.clear()
                    createAnswer()
                }
            }
        }, SessionDescription(SessionDescription.Type.OFFER, sdp))
    }

    /** WEBRTC_ICE_CANDIDATE 수신. candidate는 {"candidate","sdpMid","sdpMLineIndex"} */
    fun handleRemoteCandidate(candidate: JSONObject?) {
        if (closed || candidate == null) return
        val sdp = candidate.optString("candidate")
        if (sdp.isEmpty()) return // 빈 후보 = 후보 수집 끝 신호
        val mid = if (candidate.isNull("sdpMid")) "0" else candidate.optString("sdpMid", "0")
        val ice = IceCandidate(mid, candidate.optInt("sdpMLineIndex", 0), sdp)
        if (remoteDescriptionSet) pc.addIceCandidate(ice) else pendingCandidates.add(ice)
    }

    private fun createAnswer() {
        pc.createAnswer(object : SimpleSdpObserver("Answer 생성") {
            override fun onCreateSuccess(desc: SessionDescription?) {
                if (desc == null) { fail("Answer가 비어 있습니다"); return }
                pc.setLocalDescription(object : SimpleSdpObserver("Answer 적용") {
                    override fun onSetSuccess() {
                        if (!closed) signal(Packet.webrtcAnswer(desc.description))
                    }
                }, desc)
            }
        }, MediaConstraints())
    }

    // ------------------------------------------------------------------ 데이터 전송

    /** SENSOR 전송. 센서 전송 스레드에서 호출된다 */
    override fun send(text: String): Boolean {
        val dc = channel ?: return false
        if (closed || dc.state() != DataChannel.State.OPEN) return false
        // 무선 상태가 나빠서 쌓이기 시작하면 오래된 자세값을 보내봐야 의미가 없으므로 버린다
        if (dc.bufferedAmount() > MAX_BUFFERED_BYTES) return false
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        return dc.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
    }

    override fun close() {
        if (closed) return
        closed = true
        main.removeCallbacks(timeout)
        channel?.let {
            it.unregisterObserver()
            it.close()
            it.dispose()
        }
        channel = null
        pc.dispose() // close 포함
    }

    private fun fail(reason: String) {
        main.post {
            if (closed || failed) return@post
            failed = true
            Log.w(TAG, "WebRTC 실패: $reason")
            close()
            listener.onRtcFailed(reason)
        }
    }

    private fun channelObserver(dc: DataChannel) = object : DataChannel.Observer {
        override fun onBufferedAmountChange(previousAmount: Long) = Unit

        override fun onStateChange() {
            when (dc.state()) {
                DataChannel.State.OPEN -> onOpen()
                DataChannel.State.CLOSED -> fail("DataChannel이 닫혔습니다")
                else -> Unit
            }
        }

        override fun onMessage(buffer: DataChannel.Buffer?) {
            if (buffer == null || buffer.binary) return
            val data = buffer.data
            val bytes = ByteArray(data.remaining())
            data.get(bytes)
            val text = String(bytes, StandardCharsets.UTF_8)
            val json = try {
                JSONObject(text)
            } catch (e: JSONException) {
                Log.w(TAG, "JSON이 아닌 메시지 무시: $text")
                return
            }
            main.post { if (!closed) listener.onChannelMessage(json) }
        }
    }

    private fun onOpen() {
        main.post {
            if (closed) return@post
            main.removeCallbacks(timeout)
            listener.onChannelOpen()
        }
    }

    /** SdpObserver의 4개 메서드 중 필요한 것만 덮어쓰고, 실패는 공통 처리 */
    private open inner class SimpleSdpObserver(private val step: String) : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription?) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String?) = fail("$step 실패: $error")
        override fun onSetFailure(error: String?) = fail("$step 실패: $error")
    }

    companion object {
        private const val TAG = "RtcClient"
        /** PC/network.js의 createDataChannel('game') */
        private const val CHANNEL_LABEL = "game"
        /** PC/network.js와 같은 기준 (256 KiB) */
        private const val MAX_BUFFERED_BYTES = 262_144L

        @Volatile private var factory: PeerConnectionFactory? = null

        /** 앱 프로세스당 한 번만 초기화한다 */
        private fun factory(context: Context): PeerConnectionFactory =
            factory ?: synchronized(this) {
                factory ?: run {
                    PeerConnectionFactory.initialize(
                        PeerConnectionFactory.InitializationOptions.builder(context)
                            .createInitializationOptions()
                    )
                    PeerConnectionFactory.builder().createPeerConnectionFactory()
                }.also { factory = it }
            }

        /** JOIN_SUCCESS.ice_servers ([{"urls": "stun:..."} 또는 {"urls": ["..."]}])에서 주소만 꺼낸다 */
        fun parseIceServers(json: JSONObject): List<String> {
            val list = json.optJSONArray("ice_servers") ?: return emptyList()
            val urls = mutableListOf<String>()
            for (i in 0 until list.length()) {
                val server = list.optJSONObject(i) ?: continue
                val many = server.optJSONArray("urls")
                if (many != null) {
                    for (j in 0 until many.length()) many.optString(j).takeIf { it.isNotEmpty() }?.let(urls::add)
                } else {
                    server.optString("urls").takeIf { it.isNotEmpty() }?.let(urls::add)
                }
            }
            return urls
        }
    }
}
