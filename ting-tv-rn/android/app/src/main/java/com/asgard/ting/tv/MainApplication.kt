package com.asgard.ting.tv

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.AudioType

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    /* D-414: КРИТИЧНО. Без этого вызова аудиоустройство LiveKit не инициализировано,
       и SDK бросает IllegalStateException «Audio device module is not initialized!
       Did you remember to call LiveKitReactNative.setup in your Application.onCreate?».
       Проверено по исходнику библиотеки: LiveKitReactNative.setup НЕ вызывается
       автоматически ни автолинкингом, ни пакетом (LivekitReactNativePackage
       только создаёт нативный модуль). Именно из-за этого на ТВ не стартовал
       микрофон, а камера отдавала трек, который сразу гасился.
       Вызов ДОЛЖЕН идти до любой инициализации React Native. */
    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())

    super.onCreate()
    loadReactNative(this)
  }
}
