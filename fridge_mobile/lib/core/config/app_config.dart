class AppConfig {
  AppConfig._();

  static const String defaultBaseUrl = 'https://stellref.kz';

  static String get apiBaseUrl {
    const fromEnv = String.fromEnvironment('API_BASE_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    return defaultBaseUrl;
  }
}
