package com.gumfiled.controller.net

/**
 * 게임 데이터(SENSOR, CALIBRATE_CONFIRM)를 PC로 보내는 통로.
 *
 * 11/12 프로토타입: WsClient (서버를 거치는 WebSocket)
 * 11/26 마스터업: WebRTC DataChannel 구현체를 만들어 교체 (RtcTransport 등)
 *
 * 패킷 형식은 Packet이 만들고, 여기서는 문자열을 보내기만 한다.
 */
interface Transport {
    /** 보내기 대기열에 넣었으면 true. 여러 스레드에서 호출될 수 있다. */
    fun send(text: String): Boolean
    fun close()
}
