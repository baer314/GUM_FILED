package com.gumfiled.controller.net

import com.gumfiled.controller.Config
import com.gumfiled.controller.sensor.SensorSnapshot
import org.json.JSONObject

/**
 * "입, 출력 규격.docx"에 정의된 패킷.
 * 규격이 바뀌면 이 파일만 고치면 된다.
 */
object Packet {
    // ---- 서버/PC → 앱 ----
    const val JOIN_SUCCESS = "JOIN_SUCCESS"
    const val GAME_START = "GAME_START"
    const val WEBRTC_OFFER = "WEBRTC_OFFER"
    const val WEBRTC_ICE_CANDIDATE = "WEBRTC_ICE_CANDIDATE"

    // ---- 앱 → 서버/PC ----

    /** 규격 5번: 대기방 입장 요청 */
    fun joinRoom(pin: String): String = JSONObject()
        .put("type", "JOIN_ROOM")
        .put("pin", pin)
        .put("client_type", "CONTROLLER")
        .toString()

    /**
     * 규격 21~22번: 영점 확인.
     * button_input 값은 규격서에 "예: 0 또는 별도 확인 키 코드"로만 되어 있어 0으로 둠 → 팀 확인 필요
     */
    fun calibrateConfirm(senderId: String): String = JSONObject()
        .put("type", "CALIBRATE_CONFIRM")
        .put("sender_id", senderId)
        .put("button_input", 0)
        .toString()

    /**
     * 규격 24번: 센서 및 조작 데이터.
     * button: 0 입력 없음, 1 볼륨 상(방어), 2 볼륨 하(강타 충전)
     */
    fun sensor(senderId: String, timestamp: Long, s: SensorSnapshot, button: Int): String {
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
            .put("timestamp", timestamp)
            .put("payload", payload)
            .toString()
    }

    private fun vec3(v: FloatArray) = JSONObject()
        .put("x", v[0].toDouble())
        .put("y", v[1].toDouble())
        .put("z", v[2].toDouble())
}
