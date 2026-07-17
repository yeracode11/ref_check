import 'package:flutter/material.dart';

class NavItem {
  const NavItem({
    required this.path,
    required this.label,
    required this.icon,
  });

  final String path;
  final String label;
  final IconData icon;
}

class RoleRoutes {
  RoleRoutes._();

  static const managerOnlyPaths = {'/', '/new'};
  static const adminOnlyPaths = {'/admin', '/users', '/cities'};
  static const accountantOnlyPaths = {'/accountant'};
  static const salesOnlyPaths = {'/sales'};

  static String homeFor(String role) => switch (role) {
        'manager' => '/',
        'sales_head' => '/sales',
        _ => '/fridges',
      };

  static bool canAccess(String role, String path) {
    if (path.startsWith('/checkin/')) {
      return role == 'manager' ||
          role == 'service_manager' ||
          role == 'admin';
    }

    if (managerOnlyPaths.contains(path)) return role == 'manager';
    if (adminOnlyPaths.contains(path)) return role == 'admin';
    if (accountantOnlyPaths.contains(path)) return role == 'accountant';
    if (salesOnlyPaths.contains(path)) {
      return role == 'sales_head' || role == 'admin';
    }
    if (path == '/fridges') return true;

    return false;
  }

  static List<NavItem> navFor(String role) => switch (role) {
        'admin' => const [
            NavItem(
              path: '/fridges',
              label: 'Холодильники',
              icon: Icons.kitchen_outlined,
            ),
            NavItem(
              path: '/sales',
              label: 'Сервис НОП',
              icon: Icons.insights_outlined,
            ),
            NavItem(
              path: '/admin',
              label: 'Админ',
              icon: Icons.admin_panel_settings_outlined,
            ),
            NavItem(
              path: '/users',
              label: 'Пользователи',
              icon: Icons.group_outlined,
            ),
            NavItem(
              path: '/cities',
              label: 'Города',
              icon: Icons.location_city_outlined,
            ),
          ],
        'accountant' => const [
            NavItem(
              path: '/fridges',
              label: 'Холодильники',
              icon: Icons.kitchen_outlined,
            ),
            NavItem(
              path: '/accountant',
              label: 'Управление',
              icon: Icons.analytics_outlined,
            ),
          ],
        'service_manager' => const [
            NavItem(
              path: '/fridges',
              label: 'Холодильники',
              icon: Icons.kitchen_outlined,
            ),
          ],
        'sales_head' => const [
            NavItem(
              path: '/fridges',
              label: 'Холодильники',
              icon: Icons.kitchen_outlined,
            ),
            NavItem(
              path: '/sales',
              label: 'Управление',
              icon: Icons.analytics_outlined,
            ),
          ],
        _ => const [
            NavItem(
              path: '/',
              label: 'Отметки',
              icon: Icons.checklist_outlined,
            ),
            NavItem(
              path: '/fridges',
              label: 'Холодильники',
              icon: Icons.kitchen_outlined,
            ),
            NavItem(
              path: '/new',
              label: 'Новая отметка',
              icon: Icons.add_circle_outline,
            ),
          ],
      };

  static int navIndexForPath(String role, String path) {
    final items = navFor(role);
    final index = items.indexWhere((item) => item.path == path);
    return index >= 0 ? index : 0;
  }
}
