package com.nodetalk.client.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restores the background connection after a reboot or an app update (only if signed in and opted in). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            BackgroundConnection.sync(context)
        }
    }
}
