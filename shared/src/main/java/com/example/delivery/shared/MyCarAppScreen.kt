package com.example.delivery.shared

import android.graphics.BitmapFactory
import android.util.Base64
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.WaypointArrivedInfo
import ai.pleos.playground.navi.data.WaypointChangedInfo
import ai.pleos.playground.navi.data.WaypointInfo
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.DrivingInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import kotlin.math.abs
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.Tab
import androidx.car.app.model.TabContents
import androidx.car.app.model.TabTemplate
import androidx.core.graphics.drawable.IconCompat
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.Executors

class MyCarAppScreen(carContext: CarContext) : Screen(carContext) {
    private val api = if (carContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
        runCatching {
            LocalPickupApi(JSONObject(File(carContext.filesDir, "pickup-demo.json").readText()))
        }.getOrNull()
    } else null
    private val storage = carContext.getSharedPreferences("pickup-demo", Context.MODE_PRIVATE)
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var naviHelper: NaviHelper? = null
    private data class PickupTarget(val latitude: Double, val longitude: Double, val name: String, val address: String)
    private var navigationConnected = false
    private var pickupTarget: PickupTarget? = null
    private var destinationVerified = false
    private var routeAttempted = false
    private var waypointRequested = false
    private var routeConfirmed = false
    private var pickupIndex: WaypointIndex? = null
    private var routeStatus = "식당 승인 후 픽업 경로를 설정합니다."
    private val routeTimeout = Runnable {
        if (!destinationVerified) finishRoute("경로 응답 시간 초과 · 다시 시도하세요.")
    }
    private val navigationListener = object : NaviHelperEventListener {
        override fun onRoutingCompleted() = checkWaypoints()
        override fun onWaypointChanged(waypointChangedInfo: WaypointChangedInfo) = checkWaypoints()

        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) {
            main.post {
                if (!destroyed && discoveryStage == 0) {
                    routeOrigin = routePoint(currentLocationInfo.latitude, currentLocationInfo.longitude)
                    invalidate()
                }
            }
        }

        override fun onDestinationInfo(destinationInfo: DestinationInfo) {
            main.post {
                if (destroyed) return@post
                if (discoveryStage == 0 && orderId == null) {
                    routeDestination = routePoint(destinationInfo.latitude, destinationInfo.longitude)
                    destinationName = destinationInfo.name
                    invalidate()
                }
                if (pickupTarget != null && !destinationVerified &&
                    routePoint(destinationInfo.latitude, destinationInfo.longitude) != null) {
                    naviHelper?.getWaypointInfo()
                }
            }
        }

        override fun onWayPointInfo(waypointInfoList: List<WaypointInfo>) {
            main.post {
                val target = pickupTarget ?: return@post
                if (destroyed || order?.optString("orderStatus") != "ACCEPTED") return@post
                val index = waypointInfoList.indexOfFirst {
                    abs(it.latitude - target.latitude) < 0.00001 && abs(it.longitude - target.longitude) < 0.00001
                }
                if (index in 0..1) {
                    main.removeCallbacks(routeTimeout)
                    pickupIndex = if (index == 0) WaypointIndex.FIRST else WaypointIndex.SECOND
                    destinationVerified = true
                    routeConfirmed = true
                    renderRoute("픽업 경유지 확정 · 최종 목적지 유지")
                } else if (!waypointRequested) {
                    if (waypointInfoList.size >= 2) {
                        finishRoute("내비 경유지가 가득 찼습니다.")
                        return@post
                    }
                    waypointRequested = true
                    try {
                        naviHelper?.addWaypoint(RequestWaypointInfo(
                            latitude = target.latitude, longitude = target.longitude,
                            poiName = target.name, waypointIndex = WaypointIndex.FIRST,
                            poiId = "", poiSubId = "", address = target.address,
                        ))
                    } catch (failure: RuntimeException) {
                        Log.w("BabmatjNavigation", "Pickup waypoint request failed", failure)
                        finishRoute("픽업 경유지 요청 실패")
                    }
                }
            }
        }

        override fun onDrivingInfo(drivingInfo: DrivingInfo) {
            main.post {
                if (destroyed || !destinationVerified) return@post
                val remaining = drivingInfo.waypoints.getOrNull(if (pickupIndex == WaypointIndex.SECOND) 1 else 0)?.duration ?: return@post
                if (remaining >= 0) renderRoute("내비 남은 시간 · SDK 원시값 $remaining")
            }
        }

        override fun onWayPointArrived(waypointArrivedInfo: WaypointArrivedInfo) {
            main.post {
                if (!destroyed && destinationVerified && waypointArrivedInfo.index == pickupIndex) finishRoute("픽업 경유지 도착 · 내비 콜백")
            }
        }

        override fun onRouteCancelled() {
            main.post { if (!destroyed && pickupTarget != null) finishRoute("내비 경로 취소됨") }
        }

        override fun onError(errorCode: NaviErrorCode) {
            main.post { if (!destroyed && pickupTarget != null) finishRoute("내비 경로 오류 · $errorCode") }
        }
    }
    private var naviStatus = "차량 주문"
    private var destroyed = false
    private var loading = false
    private var error: String? = null
    private var menus = JSONArray()
    private val categories = listOf("한식", "중식", "일식", "양식", "치킨", "피자", "분식", "카페·디저트", "기타")
    private var discoveryStage = 0
    private var page = 0
    private var category = ""
    private var restaurantOptions = JSONArray()
    private var selectedRestaurant: JSONObject? = null
    private var routeOrigin: JSONObject? = null
    private var routeDestination: JSONObject? = null
    private var destinationName = ""
    private var locations = JSONArray()
    private var menuIndex = 0
    private val quantities = linkedMapOf<String, Int>()
    private var order: JSONObject? = null
    private var orderId = storage.getString("orderId", null)
    private var pending = storage.getString("pendingOrder", null)?.let(::JSONObject)

    private var pendingConfirmation: JSONObject? = null
    private val poll = object : Runnable {
        override fun run() {
            val client = api
            val id = orderId
            if (client != null && id != null && pendingConfirmation == null &&
                order?.optString("orderStatus") !in listOf("COMPLETED", "CANCELLED", "REJECTED")
            ) {
                load({ client.order(id) }, { order = it }, showProgress = false)
            }
            main.postDelayed(this, 5000)
        }
    }

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                connectNavigation()
                main.post(poll)
            }
            override fun onStop(owner: LifecycleOwner) { main.removeCallbacks(poll) }
            override fun onDestroy(owner: LifecycleOwner) {
                destroyed = true
                main.removeCallbacks(routeTimeout)
                if (navigationConnected) naviHelper?.removeListener(navigationListener)
                naviHelper?.release()
                naviHelper = null
                worker.shutdownNow()
            }
        })
    }

    private fun connectNavigation() {
        if (!carContext.packageManager.hasSystemFeature("android.hardware.type.automotive") ||
            naviHelper != null) return
        try {
            naviStatus = "내비 SDK 연결 중"
            val helper = NaviHelper(carContext.applicationContext)
            naviHelper = helper
            helper.initialize(
                onConnected = {
                    main.post {
                        if (!destroyed) {
                            helper.addListener(navigationListener)
                            navigationConnected = true
                            requestApprovedRoute()
                            showNavigationStatus("Pleos 내비 SDK 연결됨")
                        }
                    }
                },
                onFailed = { showNavigationStatus("Pleos 내비 SDK 연결 실패", it) },
            )
        } catch (failure: RuntimeException) {
            showNavigationStatus("Pleos 내비 SDK 초기화 실패", failure)
        }
    }

    private fun showNavigationStatus(status: String, failure: Throwable? = null) {
        main.post {
            if (destroyed) return@post
            naviStatus = status
            if (failure == null) Log.i("BabmatjNavigation", status)
            else Log.w("BabmatjNavigation", status, failure)
            invalidate()
        }
    }

    private fun checkWaypoints() {
        main.post {
            if (!destroyed && waypointRequested && pickupTarget != null) naviHelper?.getWaypointInfo()
        }
    }

    private fun renderRoute(status: String) {
        if (routeStatus == status) return
        routeStatus = status
        Log.i("BabmatjNavigation", status)
        invalidate()
    }

    private fun finishRoute(status: String) {
        main.removeCallbacks(routeTimeout)
        pickupTarget = null
        destinationVerified = false
        renderRoute(status)
    }

    private fun requestApprovedRoute() {
        if (!navigationConnected || routeAttempted || order?.optString("orderStatus") != "ACCEPTED") return
        val location = order?.optJSONObject("pickupLocation") ?: return
        val latitude = location.optDouble("latitude")
        val longitude = location.optDouble("longitude")
        routeAttempted = true
        if (routePoint(latitude, longitude) == null) {
            finishRoute("픽업 좌표를 확인해주세요.")
            return
        }
        pickupTarget = PickupTarget(latitude, longitude, location.optString("name"), location.optString("address"))
        waypointRequested = false
        destinationVerified = false
        renderRoute("승인 완료 · 기존 내비 목적지 확인 중")
        main.postDelayed(routeTimeout, 15_000)
        naviHelper?.getDestinationInfo()
    }

    private fun <T> load(task: () -> T, apply: (T) -> Unit, showProgress: Boolean = true) {
        if (loading || destroyed) return
        loading = true
        if (showProgress) {
            error = null
            invalidate()
        }
        worker.execute {
            val result = runCatching(task)
            main.post {
                if (destroyed) return@post
                loading = false
                result.onSuccess {
                    error = null
                    apply(it)
                    requestApprovedRoute()
                }.onFailure { failure ->
                    if (failure is PickupRequestException && !failure.retryable) {
                        pending = storage.getString("pendingOrder", null)?.let(::JSONObject)
                    }
                    error = failure.message.takeIf { failure is PickupRequestException }
                        ?: "서버에 연결할 수 없습니다. 같은 요청으로 다시 시도해주세요."
                }
                invalidate()
            }
        }
    }

    private fun loadCatalog(client: LocalPickupApi, restaurant: JSONObject) = load(
        {
            val id = restaurant.getString("restaurantId")
            client.menus(id) to client.locations(id)
        },
        { (loadedMenus, loadedLocations) ->
            menus = loadedMenus
            locations = loadedLocations
            menuIndex = 0
            selectedRestaurant = restaurant
            discoveryStage = 3
            quantities.clear()
            menus.optJSONObject(0)?.let { quantities[it.getString("id")] = 1 }
        },
    )

    private fun create(client: LocalPickupApi) {
        val body = pending ?: client.orderBody(
            selectedRestaurant!!.getString("restaurantId"), quantities,
            selectedRestaurant!!.getString("pickupLocationId"), UUID.randomUUID().toString(),
        )
        pending = body
        load({
            check(storage.edit().putString("pendingOrder", body.toString()).commit())
            try {
                client.create(body).also { created ->
                    check(storage.edit().putString("orderId", created.getString("id"))
                        .remove("pendingOrder").commit())
                }
            } catch (failure: PickupRequestException) {
                if (!failure.retryable) storage.edit().remove("pendingOrder").commit()
                throw failure
            }
        }, { created ->
            order = created
            orderId = created.getString("id")
            pending = null
        })
    }

    private fun row(
        title: String,
        detail: String? = null,
        image: CarIcon? = null,
        click: (() -> Unit)? = null,
    ): Row =
        Row.Builder().setTitle(title).apply {
            if (detail != null) addText(detail)
            if (image != null) setImage(image, Row.IMAGE_TYPE_LARGE)
            if (click != null) setOnClickListener { click() }
        }.build()

    private fun pickupEstimate(current: JSONObject?): String {
        if (current?.optString("orderStatus") in listOf("COMPLETED", "CANCELLED", "REJECTED")) return "종료"
        return current?.optJSONObject("pickupSpaceReservation")?.let {
            displayTime(it.getString("startAt"))
        } ?: "미정"
    }

    private fun displayTime(iso: String): String =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'KST'")
            .withZone(ZoneId.of("Asia/Seoul")).format(Instant.parse(iso))

    private fun confirmEta(client: LocalPickupApi, id: String, version: Int) {
        if (loading) return
        val body = pendingConfirmation ?: JSONObject()
            .put("expectedVersion", version)
            .put("requestKey", UUID.randomUUID().toString())
        pendingConfirmation = body
        load({
            runCatching { client.confirmEta(id, body) }
        }, { result ->
            result.onSuccess {
                pendingConfirmation = null
                order = it
            }.onFailure {
                if (it is PickupRequestException && !it.retryable) pendingConfirmation = null
                error = it.message ?: "서버에 연결할 수 없습니다."
            }
        })
    }

    private fun preparationEstimate(): String {
        if (quantities.isEmpty()) return "메뉴를 담아주세요."
        val selected = (0 until menus.length()).map { menus.getJSONObject(it) }
            .filter { quantities.containsKey(it.getString("id")) }
        val times = selected.map { it.optInt("baseCookMinutes", 0) }
        val estimate = if (times.size == quantities.size && times.all { it > 0 }) {
            "약 ${times.maxOrNull()}분"
        } else "미정"
        val names = selected.take(3).joinToString(", ") {
            "${it.getString("name")} ${quantities.getValue(it.getString("id"))}개"
        }
        val extra = if (selected.size > 3) " 외 ${selected.size - 3}종" else ""
        return "$estimate · $names$extra"
    }

    private fun routePoint(latitude: Double, longitude: Double): JSONObject? {
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0 ||
            (latitude == 0.0 && longitude == 0.0)) return null
        return JSONObject().put("latitude", latitude).put("longitude", longitude)
    }

    private fun imageIcon(data: String?): CarIcon? {
        if (data.isNullOrBlank() || !data.startsWith("data:image/")) return null
        val bytes = runCatching { Base64.decode(data.substringAfter(','), Base64.DEFAULT) }.getOrNull() ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth !in 1..2048 || bounds.outHeight !in 1..2048) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / inSampleSize > 256) {
                inSampleSize = maxOf(2, inSampleSize * 2)
            }
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        return CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build()
    }

    private fun chooseCategory(client: LocalPickupApi, name: String) {
        val origin = routeOrigin
        val destination = routeDestination
        val route = if (origin != null && destination != null) {
            JSONObject().put("origin", origin).put("destination", destination)
        } else null
        load({ client.restaurants(name, route) }, {
            category = name
            restaurantOptions = it
            discoveryStage = 2
            page = 0
        })
    }

    private fun restartDiscovery() {
        if (loading) return
        storage.edit().remove("orderId").apply()
        orderId = null
        order = null
        pendingConfirmation = null
        routeAttempted = false
        routeConfirmed = false
        pickupIndex = null
        finishRoute("식당 승인 후 픽업 경로를 설정합니다.")
        discoveryStage = 0
        selectedRestaurant = null
        routeOrigin = null
        routeDestination = null
        destinationName = ""
        error = null
        page = 0
        invalidate()
    }

    private fun discovery(client: LocalPickupApi): Template {
        val items = ItemList.Builder()
        val title = when (discoveryStage) {
            0 -> {
                items.addItem(row("Pleos 내비에서 최종 목적지 선택", destinationName.ifBlank { "목적지 미확인" }))
                items.addItem(row("내비 위치·목적지 불러오기", naviStatus) {
                    if (navigationConnected) {
                        naviHelper?.getCurrentLocationInfo()
                        naviHelper?.getDestinationInfo()
                    }
                })
                items.addItem(row("음식 카테고리 선택",
                    if (routeOrigin != null && routeDestination != null) "현재 내비 목적지 사용" else "경로 거리 미확인으로 계속") {
                    discoveryStage = 1
                    page = 0
                    invalidate()
                })
                "최종 목적지"
            }
            1 -> {
                categories.drop(page * 3).take(3).forEach { name ->
                    items.addItem(row(name) {
                        chooseCategory(client, name)
                    })
                }
                items.addItem(row("다음 카테고리") { page = (page + 1) % 3; invalidate() })
                items.addItem(row(error ?: "목적지 다시 선택") { if (!loading) { discoveryStage = 0; invalidate() } })
                "음식 카테고리"
            }
            else -> {
                if (carContext.carAppApiLevel >= 6) {
                    val cards = ItemList.Builder()
                    fun card(title: String, detail: String, image: CarIcon?, action: () -> Unit) {
                        cards.addItem(GridItem.Builder().setTitle(title).setText(detail)
                            .setImage(
                                image ?: CarIcon.APP_ICON,
                                if (image != null) GridItem.IMAGE_TYPE_LARGE else GridItem.IMAGE_TYPE_ICON,
                            )
                            .setOnClickListener { action() }.build())
                    }
                    for (index in page * 3 until minOf(page * 3 + 3, restaurantOptions.length())) {
                        val restaurant = restaurantOptions.getJSONObject(index)
                        val meters = restaurant.optInt("distanceMeters", -1)
                        val detail = if (meters < 0) "경로 거리 미확인" else "경유 총거리 ${meters / 1000.0} km"
                        card(restaurant.getString("restaurantName"), detail, imageIcon(restaurant.optString("imageData"))) {
                            loadCatalog(client, restaurant)
                        }
                    }
                    if (restaurantOptions.length() > 3) card("다음 식당", "목록 더 보기", null) {
                        page = (page + 1) % ((restaurantOptions.length() + 2) / 3)
                        invalidate()
                    }
                    card("카테고리 더 보기", error ?: "다른 음식 선택", null) {
                        if (!loading) { discoveryStage = 1; page = 0; invalidate() }
                    }
                    val grid = GridTemplate.Builder().setSingleList(cards.build()).build()
                    val tabs = TabTemplate.Builder(object : TabTemplate.TabCallback {
                        override fun onTabSelected(tabContentId: String) { chooseCategory(client, tabContentId) }
                    })
                        .setHeaderAction(Action.APP_ICON).setActiveTabContentId(category)
                        .setTabContents(TabContents.Builder(grid).build())
                    val groupStart = categories.indexOf(category).coerceAtLeast(0) / 3 * 3
                    categories.drop(groupStart).take(3).forEach { name ->
                        tabs.addTab(Tab.Builder().setTitle(name).setContentId(name).setIcon(CarIcon.APP_ICON).build())
                    }
                    return tabs.build()
                }
                for (index in page * 3 until minOf(page * 3 + 3, restaurantOptions.length())) {
                    val restaurant = restaurantOptions.getJSONObject(index)
                    val meters = restaurant.optInt("distanceMeters", -1)
                    val detail = if (meters < 0) "경로 거리 미확인" else "경유 총거리 ${meters / 1000.0} km"
                    val image = imageIcon(restaurant.optString("imageData"))
                    items.addItem(row(restaurant.getString("restaurantName"), detail, image) {
                        loadCatalog(client, restaurant)
                    })
                }
                if (restaurantOptions.length() == 0) items.addItem(row("주문 가능한 식당이 없습니다."))
                if (restaurantOptions.length() > 3) items.addItem(row("다음 식당") {
                    page = (page + 1) % ((restaurantOptions.length() + 2) / 3)
                    invalidate()
                })
                items.addItem(row(error ?: "카테고리 다시 선택") { if (!loading) { discoveryStage = 1; page = 0; invalidate() } })
                "$category · 경유 거리순"
            }
        }
        return ListTemplate.Builder().setTitle(title)
            .setHeaderAction(Action.APP_ICON).setSingleList(items.build()).build()
    }

    override fun onGetTemplate(): Template {
        val client = api ?: return MessageTemplate.Builder("차량 데모 설정이 필요합니다.").build()
        val id = orderId
        val progress = error ?: if (loading) "서버 응답을 기다리는 중" else null
        if (id != null) {
            val current = order
            val status = current?.optString("orderStatus")
            val statusLabel = when (status) {
                "CANCELLED" -> "CANCELLED · 주문 취소됨"
                "COMPLETED" -> "COMPLETED · 인도 완료 (식당 수동 확인)"
                null -> "새로고침하여 주문 상태를 확인하세요."
                else -> status
            }
            val rejection = current?.optString("rejectionReason", "")
                ?.takeUnless { it.isBlank() || it == "null" }
            val proposal = current?.optJSONObject("etaProposal")
            val pickupLabel = if (current?.optBoolean("pickupExpired") == true) {
                "기존 픽업 예약 만료 · 입장 불가"
            } else "확정 픽업 시간"
            val proposalText = when {
                proposal != null -> "제안 픽업 ${displayTime(proposal.getString("pickupAt"))}"
                current?.optBoolean("etaNeedsReview") == true -> "픽업 시간 확인 필요"
                else -> null
            }
            val pickupLocation = current?.optJSONObject("pickupLocation")
            val canRoute = navigationConnected && pickupLocation != null && status == "ACCEPTED"
            val pane = Pane.Builder()
                .addRow(row("주문 ID", id))
                .addRow(row("주문 상태", listOfNotNull(statusLabel, rejection).joinToString(" · ")))
                .addRow(row(pickupLabel, pickupEstimate(current)))
                .addRow(row(proposalText ?: "서버 응답", progress ?: proposal?.let {
                    "MOCK ETA · 제안 조리 시작 ${displayTime(it.getString("cookingStartAt"))}"
                } ?: routeStatus.takeIf { canRoute } ?: current?.optJSONObject("eta")?.let {
                    "MOCK 차량 ETA ${displayTime(it.getString("arrivalAt"))}"
                } ?: if (canRoute) routeStatus else "주문 상태를 새로고침할 수 있습니다."))
                .addAction(Action.Builder().setTitle("상태 새로고침").setOnClickListener {
                    load({ client.order(id) }, { order = it })
                }.build())
            if (proposal != null || pendingConfirmation != null) {
                pane.addAction(Action.Builder()
                    .setTitle(if (pendingConfirmation != null) "확정 재시도" else "변경 시간 확정")
                    .setOnClickListener { confirmEta(client, id, current?.optInt("version") ?: 0) }
                    .build())
            }
            else if (routeConfirmed || status in listOf("COMPLETED", "CANCELLED", "REJECTED")) {
                pane.addAction(Action.Builder().setTitle("처음부터 다시")
                    .setOnClickListener { restartDiscovery() }.build())
            }
            else if (canRoute && routeAttempted && pickupTarget == null && !routeStatus.contains("도착")) {
                pane.addAction(Action.Builder().setTitle("경로 다시 시도")
                    .setOnClickListener { routeAttempted = false; requestApprovedRoute() }.build())
            }
            return PaneTemplate.Builder(pane.build()).setTitle("밥맞J · 차량 주문")
                .setHeaderAction(Action.APP_ICON).build()
        }

        if (pending != null && discoveryStage != 3) {
            val retry = ItemList.Builder().addItem(row("같은 주문 요청 재시도", progress) { create(client) })
            return ListTemplate.Builder().setTitle("밥맞J · 주문 재시도")
                .setHeaderAction(Action.APP_ICON).setSingleList(retry.build()).build()
        }
        if (discoveryStage != 3) return discovery(client)

        val pickupId = selectedRestaurant?.optString("pickupLocationId")
        val pickup = (0 until locations.length()).map { locations.getJSONObject(it) }
            .firstOrNull { it.optString("id") == pickupId }
        val hasCatalog = menus.length() > 0 && pickup != null
        val selectedMenu = menus.optJSONObject(menuIndex)
        val selectedId = selectedMenu?.optString("id")
        val quantity = quantities[selectedId] ?: 0
        val menuRow = Row.Builder().setTitle("메뉴 선택")
            .addText(selectedMenu?.optString("name") ?: "미선택")
            .setOnClickListener {
                if (hasCatalog && !loading && pending == null) {
                    menuIndex = (menuIndex + 1) % menus.length()
                    invalidate()
                }
            }
        imageIcon(selectedMenu?.optString("imageData"))?.let { menuRow.setImage(it, Row.IMAGE_TYPE_LARGE) }
        val items = ItemList.Builder()
            .addItem(menuRow.build())
            .addItem(row("선택 메뉴 수량", "${quantity}개 · 누르면 0~5개 변경") {
                if (selectedId != null && !loading && pending == null) {
                    when {
                        quantity == 5 -> quantities.remove(selectedId)
                        quantity > 0 || quantities.size < 100 -> quantities[selectedId] = quantity + 1
                    }
                    invalidate()
                }
            })
            .addItem(row("주문 예상 준비시간", preparationEstimate()))
            .addItem(row("필수 픽업 장소", pickup?.optString("name") ?: "픽업 장소를 확인할 수 없습니다.") {
                if (!loading && pending == null) {
                    discoveryStage = 2
                    invalidate()
                }
            })
            .addItem(row("주문 실행", progress ?: when {
                pending != null -> "같은 주문 요청 재시도"
                hasCatalog && quantities.isEmpty() -> "주문할 메뉴를 담아주세요."
                hasCatalog -> "선택한 메뉴와 장소로 주문 보내기"
                else -> "판매 메뉴와 픽업 장소를 다시 확인해주세요."
            }) {
                if (!loading) {
                    if (pending != null || (hasCatalog && quantities.isNotEmpty())) create(client)

                }
            })
        return ListTemplate.Builder().setTitle("밥맞J · $naviStatus")
            .setHeaderAction(Action.APP_ICON).setSingleList(items.build()).build()
    }
}
