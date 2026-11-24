package com.gumfiled.controller.ui

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * 인게임(PC) 화면과 같은 느낌의 로우폴리 소품을 그리는 공용 함수.
 * 좌표는 호출하는 쪽이 canvas.scale로 맞춘 "디자인 단위"를 쓴다 (시안: APP/design/theme-mockup-v2.1.png).
 */
object GumArt {

    val P1 = Color.parseColor("#7EE3C6")
    val P2 = Color.parseColor("#F2A27E")
    val GOLD = Color.parseColor("#F0C04A")
    val CREAM = Color.parseColor("#F4EADF")
    val DECK = Color.parseColor("#7E9FB8")
    val DECK_DARK = Color.parseColor("#5B7790")

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val path = Path()
    private val clip = Path()
    private val oval = RectF()

    enum class RockTone(val light: Int, val mid: Int, val dark: Int) {
        GRAY(0xFF9EA2B8.toInt(), 0xFF7F849C.toInt(), 0xFF62667E.toInt()),
        PURPLE(0xFF8A7CC0.toInt(), 0xFF6E62A0.toInt(), 0xFF544A80.toInt()),
        BROWN(0xFFB3A196.toInt(), 0xFF8B7B70.toInt(), 0xFF6E6058.toInt()),
        BLUE(0xFF8FA3C6.toInt(), 0xFF6F85AC.toInt(), 0xFF55698E.toInt()),
    }

    /** 소행성 하나의 모양 (꼭짓점 7개). 매 프레임 같은 모양이 나오도록 미리 만들어 둔다 */
    class Rock(val cx: Float, val cy: Float, val r: Float, val tone: RockTone, rnd: Random) {
        val xs = FloatArray(7)
        val ys = FloatArray(7)

        init {
            for (i in 0 until 7) {
                val a = i / 7.0 * 2 * PI + rnd.nextDouble() * 0.4
                val rr = r * (0.75f + rnd.nextFloat() * 0.35f)
                xs[i] = cx + cos(a).toFloat() * rr
                ys[i] = cy + sin(a).toFloat() * rr
            }
        }
    }

    /** 가운데에서 부채꼴로 나눈 면마다 명암을 달리해 로우폴리처럼 보이게 한다 */
    fun drawRock(c: Canvas, rock: Rock) {
        val ox = rock.cx - rock.r * 0.15f
        val oy = rock.cy - rock.r * 0.15f
        for (i in 0 until 7) {
            val j = (i + 1) % 7
            fill.color = when {
                i < 2 -> rock.tone.light
                i < 5 -> rock.tone.mid
                else -> rock.tone.dark
            }
            path.reset()
            path.moveTo(ox, oy)
            path.lineTo(rock.xs[i], rock.ys[i])
            path.lineTo(rock.xs[j], rock.ys[j])
            path.close()
            c.drawPath(path, fill)
        }
    }

    /** 반짝이는 별 (네 갈래) */
    fun drawSparkle(c: Canvas, x: Float, y: Float, s: Float) {
        fill.color = Color.WHITE
        fill.alpha = 230
        path.reset()
        path.moveTo(x, y - s)
        path.quadTo(x, y, x + s, y)
        path.quadTo(x, y, x, y + s)
        path.quadTo(x, y, x - s, y)
        path.quadTo(x, y, x, y - s)
        path.close()
        c.drawPath(path, fill)
        fill.alpha = 255
    }

    /** 크림색 고리 행성 */
    fun drawPlanet(c: Canvas, cx: Float, cy: Float, r: Float) {
        val ring = Color.parseColor("#C9A9B8")
        oval.set(cx - r * 1.9f, cy - r * 0.42f, cx + r * 1.9f, cy + r * 0.42f)
        stroke.color = ring
        stroke.strokeWidth = r * 0.14f
        // 고리 뒤쪽
        c.save()
        c.rotate(-14f, cx, cy)
        stroke.alpha = 120
        c.drawArc(oval, 180f, 180f, false, stroke)
        c.restore()
        // 본체
        fill.color = CREAM
        c.drawCircle(cx, cy, r, fill)
        fill.color = Color.parseColor("#E3CBBE")
        path.reset()
        path.moveTo(cx - r, cy - r * 0.2f)
        path.quadTo(cx, cy - r * 0.05f, cx + r, cy - r * 0.3f)
        path.lineTo(cx + r, cy - r * 0.12f)
        path.quadTo(cx, cy + r * 0.12f, cx - r, cy)
        path.close()
        c.save()
        clip.reset()
        clip.addCircle(cx, cy, r, Path.Direction.CW)
        c.clipPath(clip)
        c.drawPath(path, fill)
        fill.color = Color.parseColor("#5A3862")
        fill.alpha = 30
        c.drawCircle(cx + r * 0.35f, cy + r * 0.3f, r * 0.9f, fill)
        fill.alpha = 255
        c.restore()
        // 고리 앞쪽
        c.save()
        c.rotate(-14f, cx, cy)
        stroke.alpha = 200
        c.drawArc(oval, 0f, 180f, false, stroke)
        c.restore()
        stroke.alpha = 255
    }

    /** 게임 캐릭터 같은 로봇 머리 (헬멧 + 검은 바이저 + 눈) */
    fun drawBot(c: Canvas, cx: Float, cy: Float, r: Float, color: Int) {
        fill.color = color
        c.drawCircle(cx, cy, r, fill)
        fill.color = Color.WHITE
        fill.alpha = 90
        c.drawCircle(cx - r * 0.35f, cy - r * 0.4f, r * 0.25f, fill)
        fill.alpha = 255
        fill.color = Color.parseColor("#141418")
        oval.set(cx - r * 0.62f, cy + r * 0.12f - r * 0.48f, cx + r * 0.62f, cy + r * 0.12f + r * 0.48f)
        c.drawOval(oval, fill)
        fill.color = color
        for (dx in floatArrayOf(-0.24f, 0.24f)) {
            oval.set(cx + r * dx - r * 0.15f, cy + r * 0.1f - r * 0.08f, cx + r * dx + r * 0.15f, cy + r * 0.1f + r * 0.08f)
            c.drawOval(oval, fill)
        }
    }

    /** 화면 아래의 원형 갑판. top = 갑판 윗선의 y */
    fun drawDeck(c: Canvas, width: Float, top: Float) {
        val cx = width / 2
        val y = top + 40f // 시안의 기준선
        oval.set(cx - 330f, y + 260f - 300f, cx + 330f, y + 260f + 300f)
        fill.color = DECK
        c.drawOval(oval, fill)
        stroke.color = DECK_DARK
        stroke.strokeWidth = 10f
        c.drawOval(oval, stroke)
        // 노란 쐐기 패널
        fill.color = GOLD
        for (p in arrayOf(floatArrayOf(-60f, 30f, 80f, -30f), floatArrayOf(260f, 370f, 420f, 300f))) {
            val off = cx - 170f
            path.reset()
            path.moveTo(p[0] + off, y + 40f)
            path.lineTo(p[1] + off, y + 40f)
            path.lineTo(p[2] + off, y + 120f)
            path.lineTo(p[3] + off, y + 120f)
            path.close()
            c.drawPath(path, fill)
        }
        // 가운데 발판
        fill.color = DECK_DARK
        oval.set(cx - 150f, y + 120f, cx + 150f, y + 280f)
        c.drawOval(oval, fill)
        stroke.color = Color.parseColor("#BFF3E4")
        stroke.strokeWidth = 4f
        stroke.alpha = 200
        oval.set(cx - 118f, y + 140f, cx + 118f, y + 260f)
        c.drawOval(oval, stroke)
        stroke.alpha = 255
        // 갑판 위 상자와 모니터
        fill.color = Color.parseColor("#5E7A5A"); c.drawRect(14f, y - 6f, 48f, y + 24f, fill)
        fill.color = Color.parseColor("#E9A53F"); c.drawRect(44f, y - 2f, 74f, y + 22f, fill)
        val mx = width - 68f
        fill.color = Color.parseColor("#2A2F3E"); c.drawRect(mx, y - 26f, mx + 44f, y + 20f, fill)
        fill.color = Color.parseColor("#BDF4F4"); c.drawRect(mx + 8f, y - 14f, mx + 34f, y, fill)
        fill.color = Color.parseColor("#E9A53F"); c.drawRect(mx + 2f, y - 36f, mx + 44f, y - 24f, fill)
    }

    /** 아래에서 올려다본 내 검 손잡이. y = 손잡이 끝(폼멜)의 위쪽 기준 */
    fun drawHilt(c: Canvas, cx: Float, y: Float, color: Int) {
        fill.color = color
        fill.alpha = 220
        c.drawRoundRect(cx - 8f, y - 50f, cx + 8f, y, 6f, 6f, fill)
        fill.alpha = 255
        fill.color = Color.parseColor("#E9D66B")
        c.drawRoundRect(cx - 44f, y - 8f, cx + 44f, y + 26f, 4f, 4f, fill)
        fill.color = color
        c.drawCircle(cx, y + 12f, 20f, fill)
    }
}
