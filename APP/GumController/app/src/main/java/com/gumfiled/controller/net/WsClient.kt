package com.gumfiled.controller.net

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 중개 서버와의 WebSocket 연결.
 * 입장(JOIN_ROOM), WebRTC 시그널링, 그리고 프로토타입 동안은 SENSOR 전송까지 담당한다.
 *
 * Listener 콜백은 전부 메인(UI) 스레드에서 호출된다.
 */
class WsClient(private val url: String, private val listener: Listener) : Transport {

    interface Listener {
        fun onOpen()
        fun onMessage(json: JSONObject)
        /** 연결 실패 또는 끊김. close()로 직접 끊은 경우에는 호출되지 않는다. */
        fun onDisconnected(reason: String)
    }

    private val main = Handler(Looper.getMainLooper())
    private val finished = AtomicBoolean(false)
    @Volatile private var closedByUser = false
    private var ws: WebSocket? = null

    fun connect() {
        val client = OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .pingInterval(10, TimeUnit.SECONDS) // 무선 연결이 조용히 죽은 걸 감지
            .build()
        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post { listener.onOpen() }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = try {
                    JSONObject(text)
                } catch (e: JSONException) {
                    Log.w(TAG, "JSON이 아닌 메시지 무시: $text")
                    return
                }
                main.post { listener.onMessage(json) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                finish("서버가 연결을 닫음 ($code ${reason.ifEmpty { "" }})".trim())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                finish(t.message ?: t.javaClass.simpleName)
            }
        })
    }

    private fun finish(reason: String) {
        if (!finished.compareAndSet(false, true)) return
        if (closedByUser) return
        Log.i(TAG, "연결 끊김: $reason")
        main.post { listener.onDisconnected(reason) }
    }

    override fun send(text: String): Boolean = ws?.send(text) ?: false

    override fun close() {
        closedByUser = true
        ws?.close(1000, "leave")
        ws = null
    }

    companion object {
        private const val TAG = "WsClient"
    }
}
