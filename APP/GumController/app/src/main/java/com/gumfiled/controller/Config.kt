package com.gumfiled.controller

/** 팀 합의에 따라 바뀔 수 있는 값을 한 곳에 모아둔다. */
object Config {
    /** SENSOR 패킷 전송 주기. 16,667us = 초당 60번 (목표.txt) */
    const val SEND_INTERVAL_US = 16_667L

    /** 센서 수신 주기. 전송(60Hz)보다 빠르게 받아서 항상 최신값을 보낸다. 200Hz 미만이라 별도 권한 불필요 */
    const val SENSOR_PERIOD_US = 10_000

    /**
     * true: TYPE_LINEAR_ACCELERATION (중력 제외, 사람이 가한 힘만)
     * false: TYPE_ACCELEROMETER (중력 포함, 가만히 있어도 약 9.8)
     * 규격서에 명시되지 않음 → 팀 확인 필요
     */
    const val USE_LINEAR_ACCELERATION = true

    /** 규격 외 필드. Back이 각속도 판정을 쓰기로 하면 true로 바꾼다 (payload.angular_velocity, rad/s) */
    const val INCLUDE_ANGULAR_VELOCITY = false

    /** 주소에 포트를 안 적었을 때 붙일 기본 포트 */
    const val DEFAULT_PORT = 8080
}
