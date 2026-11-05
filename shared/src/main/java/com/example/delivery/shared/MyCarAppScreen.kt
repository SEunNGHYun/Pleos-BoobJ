package com.example.delivery.shared

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template

// Keep a minimal valid template for the vehicle host until the new UI is built.
class MyCarAppScreen(carContext: CarContext) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        return MessageTemplate.Builder("새 화면 준비 중")
            .build()
    }
}
