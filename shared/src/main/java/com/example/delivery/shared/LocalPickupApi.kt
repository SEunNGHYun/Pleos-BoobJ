package com.example.delivery.shared

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

internal class PickupRequestException(message: String, val retryable: Boolean) : IOException(message)

internal class LocalPickupApi(private val config: JSONObject) {
    fun menus(restaurantId: String): JSONArray = JSONArray(request("/restaurants/$restaurantId/menus"))

    fun locations(restaurantId: String): JSONArray =
        JSONArray(request("/restaurants/$restaurantId/pickup-locations"))

    fun orderBody(restaurantId: String, quantities: Map<String, Int>, pickupLocationId: String, requestKey: String) =
        JSONObject().put("restaurantId", restaurantId)
            .put("pickupLocationId", pickupLocationId)
            .put("vehiclePlate", config.getString("vehiclePlate"))
            .put("contactPhone", config.getString("contactPhone"))
            .put("requestKey", requestKey)
            .put("items", JSONArray().apply {
                for ((menuId, quantity) in quantities) {
                    put(JSONObject().put("menuId", menuId).put("quantity", quantity))
                }
            })

    fun restaurants(category: String, route: JSONObject?): JSONArray =
        JSONArray(request("/pickup/restaurant-options", JSONObject()
            .put("foodCategory", category)
            .put("route", route)))

    fun create(body: JSONObject): JSONObject = JSONObject(request("/orders", body))

    fun confirmEta(id: String, body: JSONObject): JSONObject =
        JSONObject(request("/orders/$id/eta/confirm", body))

    fun order(id: String): JSONObject = JSONObject(request("/orders/$id"))

    private fun request(path: String, body: JSONObject? = null): String {
        val connection = URL("http://127.0.0.1:3001/api$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer " + config.getString("token"))
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                val message = when (status) {
                    401 -> "차량 개발 토큰을 확인해주세요."
                    404 -> "식당 또는 주문을 찾을 수 없습니다."
                    409 -> "이미 처리되었거나 주문 상태가 변경되었습니다."
                    400 -> "메뉴, 수량 또는 픽업 장소를 확인해주세요."
                    else -> "서버에 연결할 수 없습니다. 같은 요청으로 다시 시도해주세요."
                }
                throw PickupRequestException(message, status >= 500 || status == 401)
            }
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}
