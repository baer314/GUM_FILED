package com.gumfield.controller.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * 화면 가운데 그림.
 *  LOGO    연결 화면 로고 (민트 로봇 + 검)
 *  WAITING 대기 화면 (내 색 로봇 + 도는 궤도)
 *  IDLE / DEFEND / ALIGN  게임 화면 (상대 로봇 + 내 버튼 상태)
 */
class OrbView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    enum class Mode { LOGO, WAITING, IDLE, DEFEND, ALIGN }

    var mode = Mode.LOGO
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    /** 내 색 (방어막, 대기 로봇) */
    var myColor = GumArt.P1
        set(value) { field = value; invalidate() }

    /** 상대 색 (게임 화면 가운데 로봇) */
    var foeColor = GumArt.P2
        set(value) { field = value; invalidate() }

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val path = Path()
    private val oval = RectF()
    private var phase = 0f

    override fun onDraw(canvas: Canvas) {
        val box = if (mode == Mode.LOGO) 180f else 280f
        val s = min(width, height) / box
        canvas.save()
        canvas.translate(width / 2f, height / 2f)
        canvas.scale(s, s)
        when (mode) {
            Mode.LOGO -> drawLogo(canvas)
            Mode.WAITING -> drawWaiting(canvas)
            Mode.IDLE -> drawIdle(canvas)
            Mode.DEFEND -> drawDefend(canvas)
            Mode.ALIGN -> drawAlign(canvas)
        }
        canvas.restore()

        // 대기 궤도와 정렬 조준선은 천천히 돌려서 살아 있는 느낌을 준다
        if (mode == Mode.WAITING || mode == Mode.ALIGN) {
            phase = (phase + 0.6f) % 40f
            postInvalidateOnAnimation()
        }
    }

    private fun drawLogo(c: Canvas) {
        GumArt.drawBot(c, -12f, 12f, 40f, GumArt.P1)
        c.save()
        c.rotate(28f, 28f, 12f)
        fill.color = GumArt.CREAM
        c.drawRoundRect(24f, -53f, 33f, 33f, 3f, 3f, fill)
        fill.color = GumArt.GOLD
        c.drawRoundRect(10f, 23f, 46f, 32f, 3f, 3f, fill)
        c.restore()
    }

    private fun drawWaiting(c: Canvas) {
        // 궤도 뒤쪽 → 로봇 → 궤도 앞쪽
        stroke.color = GumArt.GOLD
        stroke.strokeWidth = 3f
        stroke.pathEffect = DashPathEffect(floatArrayOf(10f, 8f), -phase)
        oval.set(-115f, 38f - 24f, 115f, 38f + 24f)
        stroke.alpha = 110
        c.drawArc(oval, 180f, 180f, false, stroke)
        GumArt.drawBot(c, 0f, 0f, 60f, myColor)
        stroke.alpha = 200
        c.drawArc(oval, 0f, 180f, false, stroke)
        stroke.pathEffect = null
        stroke.alpha = 255
    }

    private fun drawIdle(c: Canvas) {
        stroke.color = myColor
        stroke.strokeWidth = 3f
        stroke.alpha = 90
        c.drawCircle(0f, 0f, 76f, stroke)
        stroke.alpha = 255
        GumArt.drawBot(c, 0f, 0f, 44f, foeColor)
    }

    private fun drawDefend(c: Canvas) {
        fill.color = myColor
        fill.alpha = 46
        c.drawCircle(0f, 0f, 92f, fill)
        fill.alpha = 255
        stroke.color = myColor
        stroke.strokeWidth = 10f
        c.drawCircle(0f, 0f, 76f, stroke)
        stroke.strokeWidth = 2f
        stroke.alpha = 128
        c.drawCircle(0f, 0f, 90f, stroke)
        stroke.alpha = 255
        GumArt.drawBot(c, 0f, 0f, 44f, foeColor)
    }

    private fun drawAlign(c: Canvas) {
        fill.color = GumArt.GOLD
        fill.alpha = 30
        c.drawCircle(0f, 0f, 80f, fill)
        fill.alpha = 255

        stroke.color = GumArt.GOLD
        stroke.strokeWidth = 4f
        stroke.pathEffect = DashPathEffect(floatArrayOf(26f, 14f), phase)
        c.drawCircle(0f, 0f, 76f, stroke)
        stroke.pathEffect = null

        stroke.strokeWidth = 5f
        stroke.strokeCap = Paint.Cap.ROUND
        for (deg in intArrayOf(0, 90, 180, 270)) {
            val t = Math.toRadians(deg.toDouble())
            val sx = sin(t).toFloat()
            val cy = -cos(t).toFloat()
            c.drawLine(sx * 84f, cy * 84f, sx * 104f, cy * 104f, stroke)
        }
        stroke.strokeCap = Paint.Cap.BUTT

        // 정면 표시 화살표
        fill.color = GumArt.GOLD
        path.reset()
        path.moveTo(0f, -128f)
        path.lineTo(-11f, -112f)
        path.lineTo(11f, -112f)
        path.close()
        c.drawPath(path, fill)

        GumArt.drawBot(c, 0f, 0f, 44f, foeColor)
    }
}
