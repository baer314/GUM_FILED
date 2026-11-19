package com.gumfiled.controller.net

import android.net.Uri
import com.gumfiled.controller.Config
import org.json.JSONObject

/** QR 또는 직접 입력으로 얻은 접속 정보 */
data class JoinInfo(val serverUrl: String?, val pin: String?) {

    companion object {
        /**
         * qr_data 형식이 아직 미정이라 흔한 형태를 모두 받아준다.
         *  - URL:   ws://192.168.0.5:8080?pin=A1B2C3   (http/https도 허용)
         *  - JSON:  {"url":"ws://192.168.0.5:8080","pin":"A1B2C3"}  (url 대신 ip+port도 허용)
         *  - PIN만: A1B2C3
         * 형식이 정해지면 해당 분기만 남기면 된다.
         */
        fun parseQr(raw: String): JoinInfo {
            val text = raw.trim()

            if (text.startsWith("{")) {
                return try {
                    val o = JSONObject(text)
                    val url = o.optString("url").ifEmpty { o.optString("server") }.ifEmpty {
                        val ip = o.optString("ip")
                        if (ip.isEmpty()) "" else "$ip:${o.optInt("port", Config.DEFAULT_PORT)}"
                    }
                    val pin = o.optString("pin").ifEmpty { o.optString("room_pin") }
                    JoinInfo(normalizeServer(url), pin.ifEmpty { null })
                } catch (e: Exception) {
                    JoinInfo(null, null)
                }
            }

            if (text.contains("://")) {
                val uri = Uri.parse(text)
                val pin = uri.getQueryParameter("pin") ?: uri.getQueryParameter("room_pin")
                val base = uri.buildUpon().clearQuery().fragment(null).build().toString()
                return JoinInfo(normalizeServer(base), pin)
            }

            if (Regex("^[A-Za-z0-9]{4,10}$").matches(text)) {
                return JoinInfo(null, text)
            }
            return JoinInfo(normalizeServer(text), null)
        }

        /**
         * 사용자가 입력한 주소를 WebSocket URL로 맞춘다.
         *  "192.168.0.5"        → ws://192.168.0.5:8080
         *  "192.168.0.5:9000"   → ws://192.168.0.5:9000
         *  "https://host"       → wss://host
         */
        fun normalizeServer(input: String?): String? {
            var s = input?.trim().orEmpty()
            if (s.isEmpty()) return null
            s = when {
                s.startsWith("http://") -> "ws://" + s.removePrefix("http://")
                s.startsWith("https://") -> "wss://" + s.removePrefix("https://")
                s.contains("://") -> s
                else -> "ws://$s"
            }
            val uri = Uri.parse(s)
            val host = uri.host
            if (host.isNullOrEmpty()) return null
            if (uri.port == -1 && uri.scheme == "ws") {
                return uri.buildUpon().encodedAuthority("$host:${Config.DEFAULT_PORT}").build().toString()
            }
            return s
        }
    }
}
