import 'package:flutter/material.dart';

import '../../widgets/section_placeholder.dart';

class AdminDashboardScreen extends StatelessWidget {
  const AdminDashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SectionPlaceholder(
      title: 'Админ',
      subtitle: 'Аналитика, импорт/экспорт, резервные копии',
      icon: Icons.admin_panel_settings_outlined,
    );
  }
}

class UsersScreen extends StatelessWidget {
  const UsersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SectionPlaceholder(
      title: 'Пользователи',
      subtitle: 'Управление учётными записями и ролями',
      icon: Icons.group_outlined,
    );
  }
}

class CitiesScreen extends StatelessWidget {
  const CitiesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SectionPlaceholder(
      title: 'Города',
      subtitle: 'Справочник городов и регионов',
      icon: Icons.location_city_outlined,
    );
  }
}
