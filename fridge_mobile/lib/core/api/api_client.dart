import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../storage/token_storage.dart';
import 'api_helpers.dart';

typedef TokenReader = Future<String?> Function();
typedef TokenRefresher = Future<String?> Function();

class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required TokenReader readAccessToken,
    required TokenRefresher refreshAccessToken,
    required this.onUnauthorized,
  })  : _readAccessToken = readAccessToken,
        _refreshAccessToken = refreshAccessToken;

  final TokenReader _readAccessToken;
  final TokenRefresher _refreshAccessToken;
  final Future<void> Function() onUnauthorized;

  bool _refreshInProgress = false;
  Future<String?>? _refreshFuture;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (options.extra['skipAuth'] == true) {
      return handler.next(options);
    }

    final token = await _readAccessToken();
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }

    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final response = err.response;
    final isUnauthorized =
        response?.statusCode == 401 || shouldRefreshToken(err);
    final alreadyRetried = err.requestOptions.extra['retried'] == true;
    final skipRefresh = err.requestOptions.extra['skipRefresh'] == true;

    if (!isUnauthorized || alreadyRetried || skipRefresh) {
      return handler.next(err);
    }

    try {
      final newToken = await _refreshOnce();
      if (newToken == null || newToken.isEmpty) {
        await onUnauthorized();
        return handler.next(err);
      }

      final requestOptions = err.requestOptions;
      requestOptions.extra['retried'] = true;
      requestOptions.headers['Authorization'] = 'Bearer $newToken';

      final dio = Dio(BaseOptions(baseUrl: requestOptions.baseUrl));
      final retryResponse = await dio.fetch(requestOptions);
      return handler.resolve(retryResponse);
    } catch (_) {
      await onUnauthorized();
      return handler.next(err);
    }
  }

  Future<String?> _refreshOnce() {
    if (_refreshInProgress && _refreshFuture != null) {
      return _refreshFuture!;
    }

    _refreshInProgress = true;
    _refreshFuture = _refreshAccessToken().whenComplete(() {
      _refreshInProgress = false;
      _refreshFuture = null;
    });

    return _refreshFuture!;
  }
}

class ApiClient {
  ApiClient({
    required TokenStorage tokenStorage,
    required Future<void> Function() onUnauthorized,
    String? baseUrl,
  })  : _tokenStorage = tokenStorage,
        _onUnauthorized = onUnauthorized,
        _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
            connectTimeout: const Duration(seconds: 20),
            receiveTimeout: const Duration(seconds: 30),
            headers: const {'Accept': 'application/json'},
          ),
        ) {
    _dio.interceptors.add(
      AuthInterceptor(
        readAccessToken: _tokenStorage.readAccessToken,
        refreshAccessToken: _refreshTokens,
        onUnauthorized: _onUnauthorized,
      ),
    );
  }

  final TokenStorage _tokenStorage;
  final Future<void> Function() _onUnauthorized;
  final Dio _dio;

  Dio get dio => _dio;

  Future<String?> _refreshTokens() async {
    final refreshToken = await _tokenStorage.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) return null;

    try {
      final response = await _dio.post(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(extra: const {'skipAuth': true, 'skipRefresh': true}),
      );

      final data = response.data as Map<String, dynamic>;
      final access = data['accessToken'] as String? ?? data['token'] as String?;
      if (access == null || access.isEmpty) return null;

      final refresh = data['refreshToken'] as String?;
      await _tokenStorage.saveTokens(
        accessToken: access,
        refreshToken: refresh,
      );
      return access;
    } catch (_) {
      return null;
    }
  }
}
