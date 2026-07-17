import 'package:dio/dio.dart';

String messageFromDio(DioException err, {String fallback = 'Ошибка запроса'}) {
  final data = err.response?.data;
  if (data is Map && data['error'] != null) {
    return data['error'].toString();
  }
  if (err.type == DioExceptionType.connectionTimeout ||
      err.type == DioExceptionType.receiveTimeout) {
    return 'Сервер не отвечает. Попробуйте позже.';
  }
  if (err.type == DioExceptionType.connectionError) {
    return 'Нет соединения с сервером.';
  }
  return fallback;
}

bool shouldRefreshToken(DioException err) {
  final status = err.response?.statusCode;
  if (status == 401) return true;
  if (status != 403) return false;

  final data = err.response?.data;
  if (data is Map && data['error'] != null) {
    final message = data['error'].toString().toLowerCase();
    return message.contains('token') ||
        message.contains('expired') ||
        message.contains('invalid') ||
        message.contains('disabled');
  }
  return false;
}

List<Map<String, dynamic>> parseListResponse(dynamic data) {
  if (data is List) {
    return data.map(_asMap).toList();
  }
  if (data is Map) {
    for (final key in ['data', 'items', 'fridges']) {
      final value = data[key];
      if (value is List) {
        return value.map(_asMap).toList();
      }
    }
  }
  return const [];
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

String? nestedField(Map<String, dynamic> source, String key, String field) {
  final nested = source[key];
  if (nested is Map) {
    return nested[field]?.toString();
  }
  return null;
}
