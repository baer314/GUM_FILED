package com.gumfiled.controller.sensor

import android.os.SystemClock
import android.util.Log
import com.gumfiled.controller.Config
import com.gumfiled.controller.net.Packet
import com.gumfiled.controller.net.Transport
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * 정해진 주기(Config.SEND_INTERVAL_US, 기본 60Hz)로 SENSOR 패킷을 보낸다.
 * 센서 콜백마다 보내지 않고 타이머로 보내는 이유: 센서 콜백 간격은 기기마다 들쭉날쭉하기 때문.
 */
class SensorStreamer(private val sampler: SensorSampler) {

    private var executor: ScheduledExecutorService? = null

    /** 실제로 보낸 패킷 수 (초당). 화면 표시용 */
    @Volatile var sentPerSecond = 0
        private set
    private var count = 0
    private var windowStartMs = 0L

    val isRunning: Boolean get() = executor != null

    /**
     * @param transport null이면 패킷만 만들고 보내지는 않는다 (센서 테스트 모드)
     * @param button 현재 버튼 상태를 돌려주는 함수 (0/1/2)
     */
    fun start(playerId: String, transport: Transport?, button: () -> Int) {
        stop()
        count = 0
        windowStartMs = SystemClock.elapsedRealtime()
        executor = Executors.newSingleThreadScheduledExecutor().also {
            it.scheduleAtFixedRate({
                // 여기서 예외가 밖으로 나가면 이후 전송이 조용히 멈추므로 반드시 잡는다
                try {
                    val packet = Packet.sensor(playerId, System.currentTimeMillis(), sampler.snapshot(), button())
                    transport?.send(packet)
                    countSent()
                } catch (e: Exception) {
                    Log.e(TAG, "센서 전송 실패", e)
                }
            }, 0, Config.SEND_INTERVAL_US, TimeUnit.MICROSECONDS)
        }
    }

    fun stop() {
        executor?.shutdownNow()
        executor = null
        sentPerSecond = 0
    }

    private fun countSent() {
        count++
        val now = SystemClock.elapsedRealtime()
        if (now - windowStartMs >= 1000) {
            sentPerSecond = count
            count = 0
            windowStartMs = now
        }
    }

    companion object {
        private const val TAG = "SensorStreamer"
    }
}
