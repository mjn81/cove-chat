package com.nodetalk.client.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.nodetalk.client.ui.screens.WhisperInviteDialog
import com.nodetalk.client.ui.screens.WhisperScreen
import com.nodetalk.client.ui.screens.WhisperStartDialog
import com.nodetalk.client.notify.CallCoordinator
import com.nodetalk.client.notify.OpenChatRequest
import com.nodetalk.client.service.BackgroundConnection
import com.nodetalk.client.ui.screens.IncomingCallDialog
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.nodetalk.client.CoveApp
import com.nodetalk.client.ui.screens.CallScreen
import com.nodetalk.client.ui.screens.ChannelListScreen
import com.nodetalk.client.ui.screens.ChatScreen
import com.nodetalk.client.ui.screens.LoginScreen
import com.nodetalk.client.ui.screens.ServerSelectScreen
import com.nodetalk.client.ui.screens.SettingsScreen

@Composable
fun NavGraph() {
    val navController = rememberNavController()
    val prefs = CoveApp.instance.preferencesManager

    val startDestination = when {
        !prefs.authToken.isNullOrBlank() -> "channels"
        prefs.hasServer -> "login"
        else -> "server"
    }

    // Notification tap: jump to that chat once logged in.
    val pending = OpenChatRequest.channelId
    LaunchedEffect(pending) {
        val id = pending ?: return@LaunchedEffect
        if (!prefs.authToken.isNullOrBlank()) {
            val name = java.net.URLEncoder.encode(OpenChatRequest.channelName.ifBlank { "Chat" }, "UTF-8")
            navController.navigate("chat/$id/$name") { launchSingleTop = true }
        }
        OpenChatRequest.channelId = null
    }

    // Incoming DM call: in-app dialog while foregrounded; Answer (here or from the notification) opens the call screen.
    val app = CoveApp.instance
    CallCoordinator.incoming?.let { call ->
        if (!prefs.authToken.isNullOrBlank()) {
            IncomingCallDialog(
                call,
                onAnswer = { CallCoordinator.answer(app, call) },
                onDecline = { CallCoordinator.decline(app, call.channelId) }
            )
        }
    }
    val answered = CallCoordinator.pendingAnswer
    LaunchedEffect(answered) {
        val call = answered ?: return@LaunchedEffect
        CallCoordinator.pendingAnswer = null
        if (!prefs.authToken.isNullOrBlank()) {
            val name = java.net.URLEncoder.encode(call.callerName, "UTF-8")
            navController.navigate("call/${call.channelId}/$name/false") { launchSingleTop = true }
        }
    }

    // Whisper: incoming requests anywhere in the app, and the expiry chooser when starting one.
    val whisper = CoveApp.instance.whisperManager
    var startWhisperFor by remember { mutableStateOf<Pair<String, String>?>(null) }
    whisper.invite?.let { inv ->
        if (!prefs.authToken.isNullOrBlank()) {
            WhisperInviteDialog(
                invite = inv,
                onAccept = { val id = whisper.accept(inv); navController.navigate("whisper/$id") },
                onDecline = { whisper.decline(inv) }
            )
        }
    }
    startWhisperFor?.let { (peerId, peerName) ->
        WhisperStartDialog(
            peerName = peerName,
            onDismiss = { startWhisperFor = null },
            onStart = { mode ->
                val id = whisper.start(peerId, peerName, mode)
                startWhisperFor = null
                navController.navigate("whisper/$id")
            }
        )
    }

    NavHost(navController = navController, startDestination = startDestination) {
        composable(
            route = "whisper/{sessionId}",
            arguments = listOf(navArgument("sessionId") { type = NavType.StringType })
        ) { entry ->
            WhisperScreen(sessionId = entry.arguments?.getString("sessionId").orEmpty(), onBack = { navController.popBackStack() })
        }

        composable("server") {
            ServerSelectScreen(
                onServerConfigured = {
                    navController.navigate("login") {
                        popUpTo("server") { inclusive = true }
                    }
                }
            )
        }

        composable("login") {
            LoginScreen(
                onLoginSuccess = {
                    BackgroundConnection.sync(CoveApp.instance)
                    navController.navigate("channels") {
                        popUpTo("login") { inclusive = true }
                    }
                },
                onChangeServer = {
                    CoveApp.instance.webSocketManager.disconnect()
                    navController.navigate("server") {
                        popUpTo("login") { inclusive = true }
                    }
                }
            )
        }

        composable("channels") {
            ChannelListScreen(
                onChannelSelected = { channelId, channelName ->
                    val encodedName = java.net.URLEncoder.encode(channelName, "UTF-8")
                    navController.navigate("chat/$channelId/$encodedName")
                },
                onOpenSettings = { navController.navigate("settings") }
            )
        }

        composable("settings") {
            SettingsScreen(
                onClose = { navController.popBackStack() },
                onStartWhisper = { id, name -> startWhisperFor = id to name },
                onOpenChat = { id, name ->
                    val enc = java.net.URLEncoder.encode(name, "UTF-8")
                    navController.navigate("chat/$id/$enc") { popUpTo("channels") }
                },
                onLogout = {
                    navController.navigate("login") {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(
            route = "chat/{channelId}/{channelName}",
            arguments = listOf(
                navArgument("channelId") { type = NavType.StringType },
                navArgument("channelName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val channelId = backStackEntry.arguments?.getString("channelId") ?: ""
            val rawName = backStackEntry.arguments?.getString("channelName") ?: ""
            val channelName = java.net.URLDecoder.decode(rawName, "UTF-8")

            ChatScreen(
                channelId = channelId,
                channelName = channelName,
                onBack = { navController.popBackStack() },
                onStartWhisper = { id, name -> startWhisperFor = id to name },
                onStartCall = { withVideo ->
                    val encodedName = java.net.URLEncoder.encode(channelName, "UTF-8")
                    navController.navigate("call/$channelId/$encodedName/$withVideo")
                }
            )
        }

        composable(
            route = "call/{channelId}/{channelName}/{withVideo}",
            arguments = listOf(
                navArgument("channelId") { type = NavType.StringType },
                navArgument("channelName") { type = NavType.StringType },
                navArgument("withVideo") { type = NavType.BoolType }
            )
        ) { backStackEntry ->
            val channelId = backStackEntry.arguments?.getString("channelId") ?: ""
            val rawName = backStackEntry.arguments?.getString("channelName") ?: ""
            val channelName = java.net.URLDecoder.decode(rawName, "UTF-8")
            val withVideo = backStackEntry.arguments?.getBoolean("withVideo") ?: false
            // Joining from anywhere stops any ringing for this channel.
            LaunchedEffect(channelId) { CallCoordinator.joined(CoveApp.instance, channelId) }

            CallScreen(
                channelId = channelId,
                channelName = channelName,
                withVideo = withVideo,
                onCallEnded = { navController.popBackStack() }
            )
        }
    }
}
