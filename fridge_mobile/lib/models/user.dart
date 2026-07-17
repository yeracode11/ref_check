class AppUser {
  const AppUser({
    required this.id,
    required this.username,
    required this.role,
    this.email,
    this.fullName,
    this.phone,
    this.cityId,
    this.active = true,
  });

  final String id;
  final String username;
  final String role;
  final String? email;
  final String? fullName;
  final String? phone;
  final dynamic cityId;
  final bool active;

  factory AppUser.fromJson(Map<String, dynamic> json) {
    final id = json['_id']?.toString() ?? json['id']?.toString();
    if (id == null || id.isEmpty) {
      throw const FormatException('Missing user id');
    }

    return AppUser(
      id: id,
      username: json['username'] as String? ?? '',
      role: json['role'] as String? ?? 'manager',
      email: json['email'] as String?,
      fullName: json['fullName'] as String?,
      phone: json['phone'] as String?,
      cityId: json['cityId'],
      active: json['active'] as bool? ?? true,
    );
  }

  String get displayName {
    if (fullName != null && fullName!.trim().isNotEmpty) return fullName!.trim();
    return username;
  }

  String? get cityLabel {
    final city = cityId;
    if (city is Map<String, dynamic>) {
      return city['name'] as String? ?? city['code'] as String?;
    }
    return null;
  }

  String get roleLabel => switch (role) {
        'manager' => 'Торговый представитель',
        'service_manager' => 'Сервисный менеджер (МХО)',
        'admin' => 'Администратор',
        'accountant' => 'Бухгалтер',
        'sales_head' => 'Начальник отдела продаж',
        _ => role,
      };
}
