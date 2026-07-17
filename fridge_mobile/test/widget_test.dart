import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fridge_mobile/config/role_routes.dart';
import 'package:fridge_mobile/core/api/api_helpers.dart';
import 'package:fridge_mobile/models/auth_tokens.dart';
import 'package:fridge_mobile/models/user.dart';

void main() {
  test('AuthTokens parses login response', () {
    final tokens = AuthTokens.fromJson({
      'token': 'access-1',
      'accessToken': 'access-1',
      'refreshToken': 'refresh-1',
      'expiresIn': 3600,
    });

    expect(tokens.accessToken, 'access-1');
    expect(tokens.refreshToken, 'refresh-1');
    expect(tokens.expiresIn, 3600);
  });

  test('AuthTokens parses legacy login response with token only', () {
    final tokens = AuthTokens.fromJson({
      'token': 'access-legacy',
    });

    expect(tokens.accessToken, 'access-legacy');
    expect(tokens.hasRefreshToken, isFalse);
  });

  test('parseListResponse reads paginated fridge payload', () {
    final items = parseListResponse({
      'data': [
        {'number': '101', 'address': 'Test'},
      ],
      'pagination': {'total': 1},
    });

    expect(items.length, 1);
    expect(items.first['number'], '101');
  });

  test('shouldRefreshToken ignores business 403 errors', () {
    final err = DioException(
      requestOptions: RequestOptions(path: '/api/fridges'),
      response: Response(
        requestOptions: RequestOptions(path: '/api/fridges'),
        statusCode: 403,
        data: {'error': 'Для роли не назначен город. Обратитесь к администратору.'},
      ),
      type: DioExceptionType.badResponse,
    );

    expect(shouldRefreshToken(err), isFalse);
  });

  test('AppUser parses backend user payload', () {
    final user = AppUser.fromJson({
      '_id': '64abc',
      'username': 'tp1',
      'role': 'manager',
      'fullName': 'Test TP',
      'cityId': {'name': 'Balkhash', 'code': 'balkhash'},
    });

    expect(user.id, '64abc');
    expect(user.displayName, 'Test TP');
    expect(user.cityLabel, 'Balkhash');
    expect(user.roleLabel, 'Торговый представитель');
  });

  test('RoleRoutes home paths match website', () {
    expect(RoleRoutes.homeFor('manager'), '/');
    expect(RoleRoutes.homeFor('admin'), '/fridges');
    expect(RoleRoutes.homeFor('accountant'), '/fridges');
    expect(RoleRoutes.homeFor('service_manager'), '/fridges');
    expect(RoleRoutes.homeFor('sales_head'), '/sales');
  });

  test('RoleRoutes access rules match website', () {
    expect(RoleRoutes.canAccess('manager', '/'), isTrue);
    expect(RoleRoutes.canAccess('manager', '/admin'), isFalse);
    expect(RoleRoutes.canAccess('admin', '/admin'), isTrue);
    expect(RoleRoutes.canAccess('admin', '/accountant'), isFalse);
    expect(RoleRoutes.canAccess('admin', '/sales'), isTrue);
    expect(RoleRoutes.canAccess('accountant', '/accountant'), isTrue);
    expect(RoleRoutes.canAccess('service_manager', '/fridges'), isTrue);
    expect(RoleRoutes.canAccess('service_manager', '/new'), isFalse);
    expect(RoleRoutes.canAccess('sales_head', '/sales'), isTrue);
    expect(RoleRoutes.canAccess('manager', '/checkin/ABC'), isTrue);
    expect(RoleRoutes.canAccess('accountant', '/checkin/ABC'), isFalse);
  });

  test('RoleRoutes nav items per role', () {
    expect(RoleRoutes.navFor('manager').map((e) => e.path), ['/', '/fridges', '/new']);
    expect(RoleRoutes.navFor('service_manager').length, 1);
    expect(RoleRoutes.navFor('admin').length, 5);
  });
}
