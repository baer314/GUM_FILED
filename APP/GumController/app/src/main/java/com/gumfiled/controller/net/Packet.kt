package com.gumfiled.controller.net

import com.gumfiled.controller.Config
import com.gumfiled.controller.sensor.SensorSnapshot
import org.json.JSONObject

/**
 * 앱 ↔ 서버/PC 패킷.
 * 실제 구현(Server/server.js, PC/network.js, PC/protocol.js) 기준으로 맞춰져 있다.
 * 규격이 바뀌면 이 파일만 고치면 된다.
 */
object Packet {
    // ---- 서버/PC → 앱 ----
    const val JOIN_SUCCESS = "JOIN_SUCCESS"
    const val GAME_START = "GAME_START"
    const val ERROR = "ERROR"
    const val ROOM_CLOSED = "ROOM_CLOSED"
    const val WEBRTC_OFFER = "WEBRTC_OFFER"
    const val WEBRTC_ICE_CANDIDATE = "WEBRTC_ICE_CANDIDATE"

    /** JOIN_SUCCESS.transport 값 */
    const val TRANSPORT_P2P = "p2p"
    const val TRANSPORT_RELAY = "relay"

    /** WebRTC 시그널링 상대 (서버가 정한 PC의 ID) */
    const val HOST_ID = "PC_HOST"

    // ---- 앱 → 서버 ----

    /** 대기방 입장 요청 */
    fun joinRoom(pin: String): String = JSONObject()
        .put("type", "JOIN_ROOM")
        .put("pin", pin)
        .put("client_type", "CONTROLLER")
        .toString()

    /** WebRTC: PC의 Offer에 대한 응답 */
    fun webrtcAnswer(sdp: String): String = JSONObject()
        .put("type", "WEBRTC_ANSWER")
        .put("target_id", HOST_ID)
        .put("sdp", sdp)
        .toString()

    /** WebRTC: 내 ICE 후보. 필드 이름은 브라우저(RTCIceCandidate.toJSON) 형식에 맞춘다 */
    fun webrtcIceCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int): String = JSONObject()
        .put("type", "WEBRTC_ICE_CANDIDATE")
        .put("target_id", HOST_ID)
        .put(
            "candidate", JSONObject()
                .put("candidate", candidate)
                .put("sdpMid", sdpMid ?: JSONObject.NULL)
                .put("sdpMLineIndex", sdpMLineIndex)
        )
        .toString()

    /**
     * 영점 확인. 서버와 PC에 아직 처리 코드가 없어서 보내면 ERROR가 돌아온다.
     * 팀에서 앱 버튼으로 영점을 잡기로 하면 MainActivity.confirmCalibration()에서 다시 사용한다.
     */
    fun calibrateConfirm(senderId: String): String = JSONObject()
        .put("type", "CALIBRATE_CONFIRM")
        .put("sender_id", senderId)
        .put("button_input", 0)
        .toString()

    /**
     * 센서 및 조작 데이터.
     * seq: 0부터 1씩 증가. PC는 이전 값 이하인 패킷을 버리고, 건너뛴 번호로 손실을 계산한다.
     * button: 0 입력 없음, 1 볼륨 상(방어), 2 볼륨 하(강타 충전)
     */
    fun sensor(senderId: String, seq: Long, timestamp: Long, s: SensorSnapshot, button: Int): String {
        val q = s.rotation // [w, x, y, z]
        val payload = JSONObject()
            .put(
                "rotation_vector", JSONObject()
                    .put("x", q[1].toDouble())
                    .put("y", q[2].toDouble())
                    .put("z", q[3].toDouble())
                    .put("w", q[0].toDouble())
            )
            .put("acceleration", vec3(s.acceleration))
            .put("button", button)
        if (Config.INCLUDE_ANGULAR_VELOCITY) {
            payload.put("angular_velocity", vec3(s.angularVelocity))
        }
        return JSONObject()
            .put("type", "SENSOR")
            .put("sender_id", senderId)
            .put("seq", seq)
            .put("timestamp", timestamp)
            .put("payload", payload)
            .toString()
    }

    private fun vec3(v: FloatArray) = JSONObject()
        .put("x", v[0].toDouble())
        .put("y", v[1].toDouble())
        .put("z", v[2].toDouble())
}
