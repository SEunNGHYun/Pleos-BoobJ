# Restaurant and pickup order API scope

Implement the prior approved restaurant/user/order model in NestJS. A user selects a restaurant-owned active pickup location during order creation; preserve the selected location snapshot for subsequent pickup retrieval. No arbitrary pickup coordinates are accepted on orders.

Routes: POST /api/restaurants (restaurant, owner membership, pickup locations, initial menus), GET /api/restaurants/:id/pickup-locations and /menus (selection data), POST /api/orders (menu IDs and quantities; server reads current names/prices), GET /api/orders/:id and /pickup-location (owner or restaurant member only).

Persist to local PGlite PostgreSQL using the existing Supabase migrations. Add a menus migration with RLS and backend-only grants. Local Auth schema/tokens are developer infrastructure outside Supabase migrations, explicitly disabled in production. CLI provisions users/tokens in ignored files; request user ID always comes from the bearer token. Database mode is opt-in; otherwise business APIs return 503. Health remains available without DB configuration.

Restaurant registration and order creation are atomic. Preserve PENDING / UNSCHEDULED / UNKNOWN on new orders; reserving capacity belongs to restaurant acceptance, outside these endpoints. Client-provided prices, statuses and user IDs are rejected. Idempotency keys replay the same order; a changed payload with the same key is a 409.

No hosted Supabase, real OAuth, web form, menu update or accept-order endpoint in this task.
