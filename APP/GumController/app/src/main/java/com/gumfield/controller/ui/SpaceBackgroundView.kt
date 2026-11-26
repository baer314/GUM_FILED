package com.gumfield.controller.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import androidx.core.content.ContextCompat
import com.gumfield.controller.R
import kotlin.random.Random

/**
 * 모든 화면 뒤에 깔리는 배경: 보랏빛 하늘, 별, 로우폴리 소행성, 고리 행성, 아래쪽 갑판.
 * 가로 340 디자인 단위 기준으로 그리고 화면 폭에 맞춰 확대한다.
 */
class SpaceBackgroundView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    enum class Scene { CONNECT, WAITING, PLAYING }

    private var scene = Scene.CONNECT
    private var player2 = false
    private var hiltColor = GumArt.P1

    private val sky = Paint()
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }

    // 디자인 단위 (가로 340 고정, 세로는 화면 비율에 따라)
    private var unit = 1f
    private var designH = 720f

    private class Star(val x: Float, val y: Float, val r: Float, val alpha: Int)
    private var stars: List<Star> = emptyList()
    private var rocks: List<GumArt.Rock> = emptyList()

    fun setScene(scene: Scene, player2: Boolean, hiltColor: Int) {
        if (this.scene == scene && this.player2 == player2 && this.hiltColor == hiltColor) return
        this.scene = scene
        this.player2 = player2
        this.hiltColor = hiltColor
        rebuild()
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        rebuild()
    }

    private fun rebuild() {
        if (width == 0 || height == 0) return
        unit = width / DESIGN_W
        designH = height / unit

        val (top, mid, low) = if (player2) {
            Triple(R.color.gum_sky_top_p2, R.color.gum_sky_mid_p2, R.color.gum_sky_low_p2)
        } else {
            Triple(R.color.gum_sky_top, R.color.gum_sky_mid, R.color.gum_sky_low)
        }
        sky.shader = LinearGradient(
            0f, 0f, 0f, height.toFloat(),
            intArrayOf(color(top), color(mid), color(low)),
            floatArrayOf(0f, 0.55f, 1f),
            Shader.TileMode.CLAMP,
        )

        // 화면마다 소행성 배치를 다르게, 하지만 늘 같은 모양으로
        val rnd = Random(SEED + scene.ordinal * 31 + if (player2) 7 else 0)
        stars = List(55) {
            Star(rnd.nextFloat() * DESIGN_W, rnd.nextFloat() * designH * 0.75f, rnd.nextFloat() + 0.4f, (rnd.nextFloat() * 130 + 75).toInt())
        }
        val T = GumArt.RockTone.values()
        rocks = when (scene) {
            Scene.CONNECT -> listOf(
                GumArt.Rock(70f, 110f, 30f, GumArt.RockTone.BROWN, rnd),
                GumArt.Rock(140f, 60f, 14f, GumArt.RockTone.PURPLE, rnd),
                GumArt.Rock(310f, 250f, 16f, GumArt.RockTone.GRAY, rnd),
                GumArt.Rock(28f, 250f, 12f, GumArt.RockTone.BLUE, rnd),
            )
            Scene.WAITING -> listOf(
                GumArt.Rock(55f, 150f, 36f, GumArt.RockTone.BROWN, rnd),
                GumArt.Rock(285f, 120f, 26f, GumArt.RockTone.BLUE, rnd),
                GumArt.Rock(230f, 60f, 14f, GumArt.RockTone.PURPLE, rnd),
                GumArt.Rock(305f, 340f, 18f, GumArt.RockTone.GRAY, rnd),
                GumArt.Rock(30f, 340f, 12f, GumArt.RockTone.PURPLE, rnd),
            )
            Scene.PLAYING -> List(5) { i ->
                // 가운데 상태 원을 피해서 양옆에 흩뿌린다
                val left = i % 2 == 0
                GumArt.Rock(
                    (if (left) 20f + rnd.nextFloat() * 60f else 260f + rnd.nextFloat() * 60f),
                    80f + i * 55f + rnd.nextFloat() * 20f,
                    12f + rnd.nextFloat() * 22f,
                    T[rnd.nextInt(T.size)],
                    rnd,
                )
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), sky)
        canvas.save()
        canvas.scale(unit, unit)

        for (s in stars) {
            dot.alpha = s.alpha
            canvas.drawCircle(s.x, s.y, s.r, dot)
        }
        GumArt.drawSparkle(canvas, 190f, 58f, 8f)
        GumArt.drawSparkle(canvas, 30f, 180f, 6f)
        GumArt.drawSparkle(canvas, 312f, 40f, 6f)

        when (scene) {
            Scene.CONNECT -> GumArt.drawPlanet(canvas, 268f, 95f, 38f)
            Scene.PLAYING -> if (player2) GumArt.drawPlanet(canvas, 262f, 70f, 34f)
            Scene.WAITING -> Unit
        }
        for (r in rocks) GumArt.drawRock(canvas, r)

        val deckTop = when (scene) {
            Scene.CONNECT -> designH - 55f
            else -> designH - 150f
        }
        GumArt.drawDeck(canvas, DESIGN_W, deckTop)
        if (scene == Scene.PLAYING) {
            GumArt.drawHilt(canvas, DESIGN_W / 2, deckTop + 110f, hiltColor)
        }
        canvas.restore()
    }

    private fun color(id: Int) = ContextCompat.getColor(context, id)

    companion object {
        private const val DESIGN_W = 340f
        private const val SEED = 11
    }
}
