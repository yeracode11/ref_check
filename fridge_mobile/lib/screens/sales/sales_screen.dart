import 'package:flutter/material.dart';

import '../../widgets/section_placeholder.dart';

class SalesScreen extends StatelessWidget {
  const SalesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SectionPlaceholder(
      title: 'Управление',
      subtitle: 'Региональный мониторинг чек-инов и ремонтов',
      icon: Icons.insights_outlined,
    );
  }
}
