export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          id: string;
          payload_jsonb: Json | null;
          target_id: string | null;
          target_table: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: string;
          created_at?: string;
          id?: string;
          payload_jsonb?: Json | null;
          target_id?: string | null;
          target_table?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          id?: string;
          payload_jsonb?: Json | null;
          target_id?: string | null;
          target_table?: string | null;
        };
        Relationships: [];
      };
      building_memberships: {
        Row: {
          building_id: string;
          created_at: string;
          id: string;
          invited_at: string | null;
          joined_at: string | null;
          status: Database["public"]["Enums"]["membership_status"];
          store_id: string;
        };
        Insert: {
          building_id: string;
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          joined_at?: string | null;
          status?: Database["public"]["Enums"]["membership_status"];
          store_id: string;
        };
        Update: {
          building_id?: string;
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          joined_at?: string | null;
          status?: Database["public"]["Enums"]["membership_status"];
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "building_memberships_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "building_memberships_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      buildings: {
        Row: {
          access_type: Database["public"]["Enums"]["building_access_type"];
          city: string | null;
          created_at: string;
          display_name: string;
          id: string;
          invite_code: string | null;
          invite_code_rotated_at: string | null;
          normalized_key: string;
          postal_code: string | null;
          public_slug: string;
        };
        Insert: {
          access_type?: Database["public"]["Enums"]["building_access_type"];
          city?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          invite_code?: string | null;
          invite_code_rotated_at?: string | null;
          normalized_key: string;
          postal_code?: string | null;
          public_slug: string;
        };
        Update: {
          access_type?: Database["public"]["Enums"]["building_access_type"];
          city?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          invite_code?: string | null;
          invite_code_rotated_at?: string | null;
          normalized_key?: string;
          postal_code?: string | null;
          public_slug?: string;
        };
        Relationships: [];
      };
      connected_accounts: {
        Row: {
          charges_enabled: boolean;
          details_submitted: boolean;
          id: string;
          last_synced_at: string | null;
          payouts_enabled: boolean;
          seller_id: string;
          stripe_account_id: string;
        };
        Insert: {
          charges_enabled?: boolean;
          details_submitted?: boolean;
          id?: string;
          last_synced_at?: string | null;
          payouts_enabled?: boolean;
          seller_id: string;
          stripe_account_id: string;
        };
        Update: {
          charges_enabled?: boolean;
          details_submitted?: boolean;
          id?: string;
          last_synced_at?: string | null;
          payouts_enabled?: boolean;
          seller_id?: string;
          stripe_account_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "connected_accounts_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: true;
            referencedRelation: "sellers";
            referencedColumns: ["id"];
          }
        ];
      };
      image_uploads: {
        Row: {
          created_at: string;
          height: number | null;
          id: string;
          key_final: string | null;
          key_pending: string | null;
          reason: string | null;
          requested_by: string;
          status: Database["public"]["Enums"]["image_upload_status"];
          store_id: string;
          updated_at: string;
          width: number | null;
        };
        Insert: {
          created_at?: string;
          height?: number | null;
          id?: string;
          key_final?: string | null;
          key_pending?: string | null;
          reason?: string | null;
          requested_by: string;
          status?: Database["public"]["Enums"]["image_upload_status"];
          store_id: string;
          updated_at?: string;
          width?: number | null;
        };
        Update: {
          created_at?: string;
          height?: number | null;
          id?: string;
          key_final?: string | null;
          key_pending?: string | null;
          reason?: string | null;
          requested_by?: string;
          status?: Database["public"]["Enums"]["image_upload_status"];
          store_id?: string;
          updated_at?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "image_uploads_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      order_items: {
        Row: {
          id: string;
          name_at_purchase: string;
          order_id: string;
          price_cents_at_purchase: number;
          product_id: string | null;
          quantity: number;
        };
        Insert: {
          id?: string;
          name_at_purchase: string;
          order_id: string;
          price_cents_at_purchase: number;
          product_id?: string | null;
          quantity: number;
        };
        Update: {
          id?: string;
          name_at_purchase?: string;
          order_id?: string;
          price_cents_at_purchase?: number;
          product_id?: string | null;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      order_tracking_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          order_id: string;
          token: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          order_id: string;
          token: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          order_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_tracking_tokens_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          }
        ];
      };
      orders: {
        Row: {
          checkout_retry_count: number;
          created_at: string;
          currency: string;
          customer_email: string;
          customer_name: string;
          customer_phone_e164: string | null;
          id: string;
          idempotency_key: string;
          notes: string | null;
          notes_seller: string | null;
          notes_shared: string | null;
          order_status: Database["public"]["Enums"]["order_status"];
          payment_mode: Database["public"]["Enums"]["payment_mode"];
          payment_status: Database["public"]["Enums"]["payment_status"];
          pickup_time: string | null;
          pickup_window: string | null;
          request_hash: string;
          stock_restored: boolean;
          store_id: string;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          total_cents: number;
          updated_at: string;
        };
        Insert: {
          checkout_retry_count?: number;
          created_at?: string;
          currency?: string;
          customer_email: string;
          customer_name: string;
          customer_phone_e164?: string | null;
          id?: string;
          idempotency_key: string;
          notes?: string | null;
          notes_seller?: string | null;
          notes_shared?: string | null;
          order_status?: Database["public"]["Enums"]["order_status"];
          payment_mode: Database["public"]["Enums"]["payment_mode"];
          payment_status: Database["public"]["Enums"]["payment_status"];
          pickup_time?: string | null;
          pickup_window?: string | null;
          request_hash: string;
          stock_restored?: boolean;
          store_id: string;
          stripe_checkout_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          total_cents: number;
          updated_at?: string;
        };
        Update: {
          checkout_retry_count?: number;
          created_at?: string;
          currency?: string;
          customer_email?: string;
          customer_name?: string;
          customer_phone_e164?: string | null;
          id?: string;
          idempotency_key?: string;
          notes?: string | null;
          notes_seller?: string | null;
          notes_shared?: string | null;
          order_status?: Database["public"]["Enums"]["order_status"];
          payment_mode?: Database["public"]["Enums"]["payment_mode"];
          payment_status?: Database["public"]["Enums"]["payment_status"];
          pickup_time?: string | null;
          pickup_window?: string | null;
          request_hash?: string;
          stock_restored?: boolean;
          store_id?: string;
          stripe_checkout_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          total_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      products: {
        Row: {
          allergens: string[];
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          image_url: string | null;
          ingredients: string | null;
          is_active: boolean;
          name: string;
          price_cents: number;
          qty_available: number | null;
          store_id: string;
          updated_at: string;
        };
        Insert: {
          allergens?: string[];
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          ingredients?: string | null;
          is_active?: boolean;
          name: string;
          price_cents: number;
          qty_available?: number | null;
          store_id: string;
          updated_at?: string;
        };
        Update: {
          allergens?: string[];
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          ingredients?: string | null;
          is_active?: boolean;
          name?: string;
          price_cents?: number;
          qty_available?: number | null;
          store_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      qr_codes: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          qr_type: Database["public"]["Enums"]["qr_type"];
          store_id: string;
          target_url: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          qr_type: Database["public"]["Enums"]["qr_type"];
          store_id: string;
          target_url: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          qr_type?: Database["public"]["Enums"]["qr_type"];
          store_id?: string;
          target_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "qr_codes_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      scan_event_daily: {
        Row: {
          bucket: number;
          count: number;
          day: string;
          src: string;
          store_id: string;
        };
        Insert: {
          bucket: number;
          count?: number;
          day: string;
          src: string;
          store_id: string;
        };
        Update: {
          bucket?: number;
          count?: number;
          day?: string;
          src?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scan_event_daily_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      sellers: {
        Row: {
          contact_address: string | null;
          contact_email: string;
          contact_phone_e164: string | null;
          created_at: string;
          display_name: string;
          id: string;
          user_id: string;
        };
        Insert: {
          contact_address?: string | null;
          contact_email: string;
          contact_phone_e164?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          user_id: string;
        };
        Update: {
          contact_address?: string | null;
          contact_email?: string;
          contact_phone_e164?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          accept_pay_at_pickup: boolean;
          category: string | null;
          created_at: string;
          description: string | null;
          first_scan_at: string | null;
          first_scan_seen_at: string | null;
          id: string;
          is_active: boolean;
          logo_url: string | null;
          name: string;
          normalized_key: string | null;
          order_count_week: number;
          pickup_method: Database["public"]["Enums"]["pickup_method"];
          pickup_private_note: string | null;
          pickup_public_note: string | null;
          pickup_window_label: string | null;
          seller_id: string;
          slug: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["store_visibility"];
        };
        Insert: {
          accept_pay_at_pickup?: boolean;
          category?: string | null;
          created_at?: string;
          description?: string | null;
          first_scan_at?: string | null;
          first_scan_seen_at?: string | null;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name: string;
          normalized_key?: string | null;
          order_count_week?: number;
          pickup_method?: Database["public"]["Enums"]["pickup_method"];
          pickup_private_note?: string | null;
          pickup_public_note?: string | null;
          pickup_window_label?: string | null;
          seller_id: string;
          slug: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["store_visibility"];
        };
        Update: {
          accept_pay_at_pickup?: boolean;
          category?: string | null;
          created_at?: string;
          description?: string | null;
          first_scan_at?: string | null;
          first_scan_seen_at?: string | null;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name?: string;
          normalized_key?: string | null;
          order_count_week?: number;
          pickup_method?: Database["public"]["Enums"]["pickup_method"];
          pickup_private_note?: string | null;
          pickup_public_note?: string | null;
          pickup_window_label?: string | null;
          seller_id?: string;
          slug?: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["store_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "stores_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "sellers";
            referencedColumns: ["id"];
          }
        ];
      };
      stripe_events: {
        Row: {
          attempts: number;
          error: string | null;
          id: string;
          payload_jsonb: Json;
          processed_at: string | null;
          processing_started_at: string | null;
          received_at: string;
          stripe_event_id: string;
          type: string;
        };
        Insert: {
          attempts?: number;
          error?: string | null;
          id?: string;
          payload_jsonb: Json;
          processed_at?: string | null;
          processing_started_at?: string | null;
          received_at?: string;
          stripe_event_id: string;
          type: string;
        };
        Update: {
          attempts?: number;
          error?: string | null;
          id?: string;
          payload_jsonb?: Json;
          processed_at?: string | null;
          processing_started_at?: string | null;
          received_at?: string;
          stripe_event_id?: string;
          type?: string;
        };
        Relationships: [];
      };
      subscribers: {
        Row: {
          consent_email: boolean;
          created_at: string;
          email: string;
          id: string;
          store_id: string;
          unsubscribe_token: string;
          unsubscribed_at: string | null;
          verified_at: string | null;
        };
        Insert: {
          consent_email?: boolean;
          created_at?: string;
          email: string;
          id?: string;
          store_id: string;
          unsubscribe_token: string;
          unsubscribed_at?: string | null;
          verified_at?: string | null;
        };
        Update: {
          consent_email?: boolean;
          created_at?: string;
          email?: string;
          id?: string;
          store_id?: string;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscribers_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_stripe_event: {
        Args: {
          p_stripe_event_id: string;
          p_stale_after_seconds?: number;
        };
        Returns: boolean;
      };
      create_store_quickstart: {
        Args: {
          p_user_id: string;
          p_contact_email: string;
          p_display_name: string;
          p_item_name: string;
          p_pickup_method: Database["public"]["Enums"]["pickup_method"];
          p_price_cents: number;
          p_slug_base: string;
          p_store_name: string;
        };
        Returns: {
          slug: string;
          store_id: string;
        }[];
      };
      get_order_by_token: {
        Args: { p_token: string };
        Returns: {
          created_at: string;
          currency: string;
          customer_name: string;
          id: string;
          order_status: Database["public"]["Enums"]["order_status"];
          payment_mode: Database["public"]["Enums"]["payment_mode"];
          payment_status: Database["public"]["Enums"]["payment_status"];
          pickup_time: string | null;
          pickup_window: string | null;
          store_id: string;
          total_cents: number;
          updated_at: string;
        }[];
      };
      get_building_product_highlights: {
        Args: { p_building_id: string; p_drop_limit?: number };
        Returns: {
          section: string;
          store_id: string;
          product_id: string;
          product_name: string;
          price_cents: number;
          image_url: string | null;
          qty_available: number | null;
          shop_name: string;
          shop_slug: string;
        }[];
      };
      sync_buildings_and_memberships: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      sync_store_building_membership: {
        Args: { p_store_id: string };
        Returns: undefined;
      };
      place_order: {
        Args: {
          p_store_id: string;
          p_customer_name: string;
          p_customer_email: string;
          p_customer_phone_e164: string | null;
          p_payment_mode: Database["public"]["Enums"]["payment_mode"];
          p_pickup_window: string | null;
          p_notes: string | null;
          p_idempotency_key: string;
          p_request_hash: string;
          p_token: string;
          p_token_ttl_hours: number;
          p_items: Json;
        };
        Returns: {
          order_id: string;
          token: string;
          total_cents: number;
          replayed: boolean;
        }[];
      };
      mark_order_refunded: {
        Args: {
          p_order_id: string;
          p_charge_id: string;
          p_amount_refunded: number;
        };
        Returns: string | null;
      };
      mark_pay_at_pickup_paid: {
        Args: {
          p_order_id: string;
          p_seller_user_id: string;
        };
        Returns: Database["public"]["Enums"]["payment_status"];
      };
      get_store_scan_summary: {
        Args: { p_store_id: string };
        Returns: {
          src: string;
          count: number;
        }[];
      };
      record_scan: {
        Args: { p_store_id: string; p_src: string };
        Returns: undefined;
      };
      transition_order_status: {
        Args: {
          p_order_id: string;
          p_seller_user_id: string;
          p_to: Database["public"]["Enums"]["order_status"];
        };
        Returns: {
          order_status: Database["public"]["Enums"]["order_status"];
          from_status: Database["public"]["Enums"]["order_status"];
        }[];
      };
    };
    Enums: {
      building_access_type: "open" | "invite";
      image_upload_status: "pending" | "ready" | "rejected";
      membership_status: "pending" | "active" | "removed";
      order_status:
        | "new"
        | "accepted"
        | "preparing"
        | "ready"
        | "complete"
        | "cancelled";
      payment_mode: "online" | "pay_at_pickup";
      payment_status:
        | "unpaid"
        | "pay_at_pickup"
        | "paid"
        | "refunded"
        | "failed"
        | "refund_pending"
        | "refund_failed";
      pickup_method: "message_after_order" | "lobby_pickup" | "scheduled_window";
      qr_type: "store" | "product" | "bazaar";
      store_visibility: "qr_only" | "building" | "nearby";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {}
  },
  public: {
    Enums: {
      building_access_type: ["open", "invite"],
      membership_status: ["pending", "active", "removed"],
      order_status: ["new", "accepted", "preparing", "ready", "complete", "cancelled"],
      payment_mode: ["online", "pay_at_pickup"],
      payment_status: [
        "unpaid",
        "pay_at_pickup",
        "paid",
        "refunded",
        "failed",
        "refund_pending",
        "refund_failed"
      ],
      pickup_method: ["message_after_order", "lobby_pickup", "scheduled_window"],
      qr_type: ["store", "product", "bazaar"],
      store_visibility: ["qr_only", "building", "nearby"]
    }
  }
} as const;
