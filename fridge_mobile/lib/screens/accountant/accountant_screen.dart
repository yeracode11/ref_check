import 'package:flutter/material.dart';

import '../../widgets/section_placeholder.dart';

class AccountantScreen extends StatelessWidget {
  const AccountantScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SectionPlaceholder(
      title: 'Управление',
      subtitle: 'Холодильники, карта и аналитика по городу',
      icon: Icons.analytics_outlined,
    );
  }
}
