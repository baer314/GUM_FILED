package com.gumfiled.controller.sensor

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.gumfiled.controller.Config

/** 한 시점의 센서값 묶음 (복사본이라 다른 스레드에서 읽어도 안전) */
class SensorSnapshot(
    /** 쿼터니언 [w, x, y, z] */
    val rotation: FloatArray,
    /** m/s², 폰 기준 좌표 */
    val acceleration: FloatArray,
    /** rad/s, 폰 기준 좌표 */
    val angularVelocity: FloatArray,
)

/**
 * 센서를 등록하고 최신값만 보관한다.
 * 전송은 SensorStreamer가 정해진 주기로 snapshot()을 꺼내 가는 방식.
 *
 * 자세: TYPE_GAME_ROTATION_VECTOR (지자기 미사용 → 실내 철제 물건에 영향 안 받음)
 */
class SensorSampler(context: Context) : SensorEventListener {

    private val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val rotationSensor: Sensor? = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
    private val accelSensor: Sensor? = sm.getDefaultSensor(
        if (Config.USE_LINEAR_ACCELERATION) Sensor.TYPE_LINEAR_ACCELERATION else Sensor.TYPE_ACCELEROMETER
    )
    private val gyroSensor: Sensor? = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)

    private val lock = Any()
    private val rotation = floatArrayOf(1f, 0f, 0f, 0f)
    private val acceleration = FloatArray(3)
    private val angularVelocity = FloatArray(3)
    private val tmpQ = FloatArray(4)

    /** 화면에 표시할 실제 수신 빈도 (회전 벡터 기준, 초당 횟수) */
    @Volatile var rotationRate = 0
        private set
    private var rotationCount = 0
    private var windowStartNs = 0L

    /** 이 기기에 없는 센서 이름 목록. 비어 있으면 정상 */
    fun missingSensors(): List<String> = buildList {
        if (rotationSensor == null) add("회전 벡터(게임용)")
        if (accelSensor == null) add(if (Config.USE_LINEAR_ACCELERATION) "선형 가속도" else "가속도")
        if (gyroSensor == null) add("자이로스코프")
    }

    fun start() {
        listOfNotNull(rotationSensor, accelSensor, gyroSensor).forEach {
            sm.registerListener(this, it, Config.SENSOR_PERIOD_US)
        }
    }

    fun stop() {
        sm.unregisterListener(this)
    }

    fun snapshot(): SensorSnapshot = synchronized(lock) {
        SensorSnapshot(rotation.copyOf(), acceleration.copyOf(), angularVelocity.copyOf())
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                // values는 [x, y, z, w(, 오차)] 형태 → [w, x, y, z]로 변환
                SensorManager.getQuaternionFromVector(tmpQ, event.values)
                synchronized(lock) { tmpQ.copyInto(rotation) }
                countRotation(event.timestamp)
            }
            Sensor.TYPE_LINEAR_ACCELERATION, Sensor.TYPE_ACCELEROMETER ->
                synchronized(lock) { event.values.copyInto(acceleration, 0, 0, 3) }
            Sensor.TYPE_GYROSCOPE ->
                synchronized(lock) { event.values.copyInto(angularVelocity, 0, 0, 3) }
        }
    }

    private fun countRotation(timestampNs: Long) {
        rotationCount++
        if (windowStartNs == 0L) windowStartNs = timestampNs
        if (timestampNs - windowStartNs >= 1_000_000_000L) {
            rotationRate = rotationCount
            rotationCount = 0
            windowStartNs = timestampNs
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
