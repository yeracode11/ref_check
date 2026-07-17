import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api_helpers.dart';
import '../../core/theme/app_colors.dart';
import '../../services/fridge_service.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/page_header.dart';

class FridgesScreen extends StatefulWidget {
  const FridgesScreen({super.key});

  @override
  State<FridgesScreen> createState() => _FridgesScreenState();
}

class _FridgesScreenState extends State<FridgesScreen> {
  final _searchController = TextEditingController();
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _reload() {
    _future = context.read<FridgeService>().fetchFridges(
          search: _searchController.text.trim(),
        );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const PageHeader(
          title: 'Холодильники',
          subtitle: 'Список по вашему городу',
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: SearchBar(
            controller: _searchController,
            hintText: 'Номер, адрес или клиент',
            leading: const Icon(Icons.search, size: 22),
            padding: const WidgetStatePropertyAll(
              EdgeInsets.symmetric(horizontal: 12),
            ),
            onSubmitted: (_) => setState(_reload),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<Map<String, dynamic>>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const LoadingState(message: 'Загружаем холодильники…');
              }

              if (snapshot.hasError) {
                final message = snapshot.error is DioException
                    ? messageFromDio(
                        snapshot.error as DioException,
                        fallback: 'Не удалось получить список холодильников',
                      )
                    : 'Не удалось получить список холодильников';

                return EmptyState(
                  icon: Icons.cloud_off_outlined,
                  title: 'Ошибка загрузки',
                  message: message,
                  actionLabel: 'Повторить',
                  onAction: () => setState(_reload),
                );
              }

              final items = snapshot.data ?? const [];
              if (items.isEmpty) {
                return EmptyState(
                  icon: Icons.kitchen_outlined,
                  title: 'Ничего не найдено',
                  message: _searchController.text.trim().isEmpty
                      ? 'В вашем городе пока нет холодильников'
                      : 'Попробуйте другой запрос',
                  actionLabel: 'Сбросить поиск',
                  onAction: () {
                    _searchController.clear();
                    setState(_reload);
                  },
                );
              }

              return RefreshIndicator(
                color: AppColors.accent,
                onRefresh: () async {
                  setState(_reload);
                  await _future;
                },
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                  itemCount: items.length,
                  separatorBuilder: (context, index) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final fridge = items[index];
                    final number = fridge['number']?.toString() ??
                        fridge['code']?.toString() ??
                        '—';
                    final address = fridge['address']?.toString() ??
                        nestedField(fridge, 'clientInfo', 'address') ??
                        'Адрес не указан';
                    final client = nestedField(fridge, 'clientInfo', 'name');
                    final active = fridge['active'] as bool? ?? true;

                    return Container(
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: () {},
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  width: 48,
                                  height: 48,
                                  decoration: BoxDecoration(
                                    color: AppColors.accentLight,
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                  child: const Icon(
                                    Icons.kitchen,
                                    color: AppColors.accent,
                                  ),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              '№ $number',
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .titleSmall
                                                  ?.copyWith(
                                                    fontWeight: FontWeight.w700,
                                                  ),
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 8,
                                              vertical: 2,
                                            ),
                                            decoration: BoxDecoration(
                                              color: active
                                                  ? AppColors.successLight
                                                  : AppColors.muted,
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: Text(
                                              active ? 'Активен' : 'Неактивен',
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .labelSmall
                                                  ?.copyWith(
                                                    color: active
                                                        ? AppColors.success
                                                        : AppColors.textSecondary,
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                            ),
                                          ),
                                        ],
                                      ),
                                      if (client != null && client.isNotEmpty) ...[
                                        const SizedBox(height: 4),
                                        Text(
                                          client,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: Theme.of(context)
                                              .textTheme
                                              .bodyMedium
                                              ?.copyWith(
                                                fontWeight: FontWeight.w500,
                                              ),
                                        ),
                                      ],
                                      const SizedBox(height: 4),
                                      Text(
                                        address,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: AppColors.textSecondary,
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                                Icon(
                                  Icons.chevron_right,
                                  color: AppColors.textSecondary.withValues(alpha: 0.6),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
