import 'package:dio/dio.dart';

import '../core/api/api_client.dart';
import '../core/api/api_helpers.dart';

class FridgeService {
  FridgeService(this._apiClient);

  final ApiClient _apiClient;

  Dio get _dio => _apiClient.dio;

  Future<List<Map<String, dynamic>>> fetchFridges({String? search}) async {
    final response = await _dio.get(
      '/api/fridges',
      queryParameters: {
        'simple': '1',
        'limit': 100,
        if (search != null && search.isNotEmpty) 'search': search,
      },
    );

    return parseListResponse(response.data);
  }

  Future<Map<String, dynamic>> lookupByCode(String code) async {
    final response = await _dio.get(
      '/api/mobile/fridges/lookup',
      queryParameters: {'code': code},
    );
    final data = response.data;
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    throw const FormatException('Unexpected lookup response');
  }
}
