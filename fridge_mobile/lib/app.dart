import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'config/role_routes.dart';
import 'core/theme/app_theme.dart';
import 'providers/auth_controller.dart';
import 'screens/accountant/accountant_screen.dart';
import 'screens/admin/admin_screens.dart';
import 'screens/login_screen.dart';
import 'screens/manager/checkins_screen.dart';
import 'screens/manager/new_checkin_screen.dart';
import 'screens/sales/sales_screen.dart';
import 'screens/shared/checkin_code_screen.dart';
import 'screens/shared/fridges_screen.dart';
import 'screens/splash_screen.dart';
import 'widgets/app_shell.dart';

GoRouter createRouter(AuthController auth) {
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: auth,
    redirect: (context, state) {
      final path = state.uri.path;
      final status = auth.status;

      if (status == AuthStatus.unknown) {
        return path == '/splash' ? null : '/splash';
      }

      if (status == AuthStatus.unauthenticated) {
        return path == '/login' ? null : '/login';
      }

      final user = auth.user;
      if (user == null) return '/login';

      if (path == '/splash' || path == '/login') {
        return RoleRoutes.homeFor(user.role);
      }

      if (!RoleRoutes.canAccess(user.role, path)) {
        return RoleRoutes.homeFor(user.role);
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => const CheckinsScreen(),
          ),
          GoRoute(
            path: '/new',
            builder: (context, state) => const NewCheckinScreen(),
          ),
          GoRoute(
            path: '/fridges',
            builder: (context, state) => const FridgesScreen(),
          ),
          GoRoute(
            path: '/admin',
            builder: (context, state) => const AdminDashboardScreen(),
          ),
          GoRoute(
            path: '/users',
            builder: (context, state) => const UsersScreen(),
          ),
          GoRoute(
            path: '/cities',
            builder: (context, state) => const CitiesScreen(),
          ),
          GoRoute(
            path: '/accountant',
            builder: (context, state) => const AccountantScreen(),
          ),
          GoRoute(
            path: '/sales',
            builder: (context, state) => const SalesScreen(),
          ),
          GoRoute(
            path: '/checkin/:code',
            builder: (context, state) {
              final code = state.pathParameters['code'] ?? '';
              return CheckinCodeScreen(code: code);
            },
          ),
        ],
      ),
    ],
  );
}

class FridgeApp extends StatefulWidget {
  const FridgeApp({super.key});

  @override
  State<FridgeApp> createState() => _FridgeAppState();
}

class _FridgeAppState extends State<FridgeApp> {
  late final AuthController _auth;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _auth = context.read<AuthController>();
    _router = createRouter(_auth);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _auth.initialize();
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'StellRef',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: _router,
    );
  }
}
