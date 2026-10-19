package com.nodetalk.client.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import com.nodetalk.client.notify.OpenChatRequest
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.ui.screens.CallScreen
import com.nodetalk.client.ui.screens.ChannelListScreen
import com.nodetalk.client.ui.screens.ChatScreen
import com.nodetalk.client.ui.screens.LoginScreen
import com.nodetalk.client.ui.screens.ServerSelectScreen
import com.nodetalk.client.ui.screens.SettingsScreen

@Composable
fun NavGraph() {
    val navController = rememberNavController()
    val prefs = NodeTalkApp.instance.preferencesManager

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

    NavHost(navController = navController, startDestination = startDestination) {
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
                    navController.navigate("channels") {
                        popUpTo("login") { inclusive = true }
                    }
                },
                onChangeServer = {
                    NodeTalkApp.instance.webSocketManager.disconnect()
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

            CallScreen(
                channelId = channelId,
                channelName = channelName,
                withVideo = withVideo,
                onCallEnded = { navController.popBackStack() }
            )
        }
    }
}
