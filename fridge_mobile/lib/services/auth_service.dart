import 'package:dio/dio.dart';

import '../core/api/api_client.dart';
import '../models/auth_tokens.dart';
import '../models/user.dart';

class AuthService {
  AuthService(this._apiClient);

  final ApiClient _apiClient;

  Dio get _dio => _apiClient.dio;

  Future<({AuthTokens tokens, AppUser user})> login({
    required String username,
    required String password,
  }) async {
    final response = await _dio.post(
      '/api/auth/login',
      data: {
        'username': username.trim(),
        'password': password,
      },
      options: Options(extra: const {'skipAuth': true, 'skipRefresh': true}),
    );

    final data = response.data as Map<String, dynamic>;
    final tokens = AuthTokens.fromJson(data);
    final user = AppUser.fromJson(data['user'] as Map<String, dynamic>);
    return (tokens: tokens, user: user);
  }

  Future<AppUser> fetchCurrentUser() async {
    final response = await _dio.get('/api/auth/me');
    return AppUser.fromJson(response.data as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> fetchConfig() async {
    final response = await _dio.get(
      '/api/auth/config',
      options: Options(extra: const {'skipAuth': true, 'skipRefresh': true}),
    );
    return response.data as Map<String, dynamic>;
  }
}
