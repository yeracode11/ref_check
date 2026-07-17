import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_controller.dart';
import '../../widgets/page_header.dart';

class CheckinCodeScreen extends StatelessWidget {
  const CheckinCodeScreen({super.key, required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthController>().user;
    final isService = user?.role == 'service_manager';
    final scheme = Theme.of(context).colorScheme;

    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        PageHeader(
          title: isService ? 'Ремонт МХО' : 'Чек-ин',
          subtitle: 'Код: $code',
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  Icon(
                    isService ? Icons.build_circle_outlined : Icons.qr_code_2,
                    size: 56,
                    color: scheme.primary,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    isService
                        ? 'История ремонтов и работы МХО'
                        : 'Оформление визита с GPS и фото',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Экран /checkin/:code — как на сайте',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
