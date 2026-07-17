import 'package:dio/dio.dart';

import '../core/api/api_client.dart';

class CheckinService {
  CheckinService(this._apiClient);

  final ApiClient _apiClient;

  Dio get _dio => _apiClient.dio;

  Future<List<Map<String, dynamic>>> fetchMyCheckins() async {
    final response = await _dio.get('/api/checkins', queryParameters: {
      'limit': 50,
    });
    final data = response.data;
    if (data is List) {
      return data.cast<Map<String, dynamic>>();
    }
    if (data is Map && data['data'] is List) {
      return (data['data'] as List).cast<Map<String, dynamic>>();
    }
    return const [];
  }

  Future<({String date, int total, List<Map<String, dynamic>> items})>
      fetchTodayCheckins() async {
    try {
      final response = await _dio.get('/api/mobile/checkins/today');
      final data = response.data as Map<String, dynamic>;
      return (
        date: data['date'] as String? ?? '',
        total: data['total'] as int? ?? 0,
        items: (data['data'] as List? ?? const [])
            .cast<Map<String, dynamic>>(),
      );
    } on DioException catch (err) {
      if (err.response?.statusCode == 404) {
        final fallback = await fetchMyCheckins();
        return (date: '', total: fallback.length, items: fallback);
      }
      rethrow;
    }
  }
}
