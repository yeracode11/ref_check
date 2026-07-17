import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'core/api/api_client.dart';
import 'core/storage/token_storage.dart';
import 'providers/auth_controller.dart';
import 'services/auth_service.dart';
import 'services/checkin_service.dart';
import 'services/fridge_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  final tokenStorage = TokenStorage();
  late final AuthController authController;
  late final ApiClient apiClient;

  apiClient = ApiClient(
    tokenStorage: tokenStorage,
    onUnauthorized: () => authController.handleUnauthorized(),
  );

  authController = AuthController(
    tokenStorage: tokenStorage,
    authService: AuthService(apiClient),
  );

  final checkinService = CheckinService(apiClient);
  final fridgeService = FridgeService(apiClient);

  runApp(
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: apiClient),
        Provider<CheckinService>.value(value: checkinService),
        Provider<FridgeService>.value(value: fridgeService),
        ChangeNotifierProvider<AuthController>.value(value: authController),
      ],
      child: const FridgeApp(),
    ),
  );
}
