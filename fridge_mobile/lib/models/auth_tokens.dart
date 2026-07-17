class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    this.refreshToken,
    this.expiresIn,
    this.tokenType = 'Bearer',
  });

  final String accessToken;
  final String? refreshToken;
  final int? expiresIn;
  final String tokenType;

  bool get hasRefreshToken =>
      refreshToken != null && refreshToken!.isNotEmpty;

  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    final access = json['accessToken'] as String? ?? json['token'] as String?;
    if (access == null || access.isEmpty) {
      throw const FormatException('Missing access token in auth response');
    }

    final refresh = json['refreshToken'] as String?;

    return AuthTokens(
      accessToken: access,
      refreshToken: refresh?.isNotEmpty == true ? refresh : null,
      expiresIn: json['expiresIn'] as int?,
      tokenType: json['tokenType'] as String? ?? 'Bearer',
    );
  }
}
