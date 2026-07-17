import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../core/api/api_helpers.dart';
import '../core/storage/token_storage.dart';
import '../models/user.dart';
import '../services/auth_service.dart';

enum AuthStatus {
  unknown,
  authenticated,
  unauthenticated,
}

class AuthController extends ChangeNotifier {
  AuthController({
    required TokenStorage tokenStorage,
    required AuthService authService,
  })  : _tokenStorage = tokenStorage,
        _authService = authService;

  final TokenStorage _tokenStorage;
  final AuthService _authService;

  AuthStatus status = AuthStatus.unknown;
  AppUser? user;
  String? errorMessage;
  bool busy = false;

  Future<void> initialize() async {
    busy = true;
    notifyListeners();

    try {
      final accessToken = await _tokenStorage.readAccessToken();
      if (accessToken == null || accessToken.isEmpty) {
        _setUnauthenticated();
        return;
      }

      user = await _authService.fetchCurrentUser();
      status = AuthStatus.authenticated;
      errorMessage = null;
    } catch (_) {
      await _tokenStorage.clear();
      _setUnauthenticated();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> login({
    required String username,
    required String password,
  }) async {
    busy = true;
    errorMessage = null;
    notifyListeners();

    try {
      final result = await _authService.login(
        username: username,
        password: password,
      );

      await _tokenStorage.saveTokens(
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
      );

      user = result.user;
      status = AuthStatus.authenticated;
    } on DioException catch (err) {
      errorMessage = messageFromDio(err, fallback: 'Ошибка входа. Попробуйте снова.');
      status = AuthStatus.unauthenticated;
    } on FormatException catch (err) {
      errorMessage = err.message;
      status = AuthStatus.unauthenticated;
    } catch (err) {
      errorMessage = err.toString();
      status = AuthStatus.unauthenticated;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await _tokenStorage.clear();
    user = null;
    errorMessage = null;
    status = AuthStatus.unauthenticated;
    notifyListeners();
  }

  Future<void> handleUnauthorized() async {
    await _tokenStorage.clear();
    user = null;
    status = AuthStatus.unauthenticated;
    notifyListeners();
  }

  void _setUnauthenticated() {
    status = AuthStatus.unauthenticated;
    user = null;
  }
}
