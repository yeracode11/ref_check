import 'package:flutter/material.dart';

/// Design tokens — StellRef Mobile (Trust & Authority / B2B field service)
abstract final class AppColors {
  static const primary = Color(0xFF0F172A);
  static const onPrimary = Color(0xFFFFFFFF);
  static const accent = Color(0xFF0369A1);
  static const accentLight = Color(0xFFE0F2FE);
  static const background = Color(0xFFF8FAFC);
  static const surface = Color(0xFFFFFFFF);
  static const foreground = Color(0xFF020617);
  static const muted = Color(0xFFE8ECF1);
  static const border = Color(0xFFE2E8F0);
  static const textSecondary = Color(0xFF64748B);
  static const success = Color(0xFF059669);
  static const successLight = Color(0xFFD1FAE5);
  static const warning = Color(0xFFD97706);
  static const warningLight = Color(0xFFFEF3C7);
}

abstract final class AppSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xxl = 48.0;

  static const radiusSm = 12.0;
  static const radiusMd = 16.0;
  static const radiusLg = 20.0;
  static const radiusXl = 24.0;
}
