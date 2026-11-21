package com.gumfiled.controller.net

/**
 * 게임 데이터(SENSOR)를 PC로 보내는 통로.
 *
 *  - relay 모드: WsClient (서버를 거치는 WebSocket)
 *  - p2p 모드:   RtcClient (PC와 직접 연결되는 WebRTC DataChannel)
 *
 * 어느 쪽을 쓸지는 서버가 JOIN_SUCCESS.transport로 알려준다 (MainActivity.startCalibration).
 * 패킷 형식은 Packet이 만들고, 여기서는 문자열을 보내기만 한다.
 */
interface Transport {
    /** 보내기 대기열에 넣었으면 true. 센서 전송 스레드에서 호출된다. */
    fun send(text: String): Boolean
    fun close()
}
