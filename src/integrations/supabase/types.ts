export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      feriados: {
        Row: {
          created_at: string
          data: string
          descricao: string
          id: string
          origem: string
        }
        Insert: {
          created_at?: string
          data: string
          descricao: string
          id?: string
          origem?: string
        }
        Update: {
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          origem?: string
        }
        Relationships: []
      }
      manual_bookings: {
        Row: {
          battery_type: Database["public"]["Enums"]["battery_type"]
          created_at: string | null
          created_by: string | null
          customer_name: string
          customer_phone: string
          id: string
          notes: string | null
          num_pilots: number
          time_slot_id: string
          updated_at: string | null
        }
        Insert: {
          battery_type?: Database["public"]["Enums"]["battery_type"]
          created_at?: string | null
          created_by?: string | null
          customer_name: string
          customer_phone: string
          id?: string
          notes?: string | null
          num_pilots: number
          time_slot_id: string
          updated_at?: string | null
        }
        Update: {
          battery_type?: Database["public"]["Enums"]["battery_type"]
          created_at?: string | null
          created_by?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          notes?: string | null
          num_pilots?: number
          time_slot_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_bookings_time_slot_id_fkey"
            columns: ["time_slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_alerts: {
        Row: {
          alert_type: string
          detail: string | null
          detected_at: string
          id: string
          notified_at: string | null
          reservation_id: string | null
          resolved_at: string | null
        }
        Insert: {
          alert_type: string
          detail?: string | null
          detected_at?: string
          id?: string
          notified_at?: string | null
          reservation_id?: string | null
          resolved_at?: string | null
        }
        Update: {
          alert_type?: string
          detail?: string | null
          detected_at?: string
          id?: string
          notified_at?: string | null
          reservation_id?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_alerts_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          abandonment_notified_at: string | null
          asaas_customer_id: string | null
          attendance_status: string | null
          battery_type: Database["public"]["Enums"]["battery_type"]
          checked_in_at: string | null
          checked_in_by: string | null
          checkout_url: string | null
          checkout_url_expires_at: string | null
          created_at: string | null
          customer_email: string
          customer_name: string
          customer_phone: string
          id: string
          num_pilots: number
          payment_id: string | null
          payment_method: string | null
          reservation_code: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          time_slot_id: string
          updated_at: string | null
          valor_total: number
        }
        Insert: {
          abandonment_notified_at?: string | null
          asaas_customer_id?: string | null
          attendance_status?: string | null
          battery_type?: Database["public"]["Enums"]["battery_type"]
          checked_in_at?: string | null
          checked_in_by?: string | null
          checkout_url?: string | null
          checkout_url_expires_at?: string | null
          created_at?: string | null
          customer_email: string
          customer_name: string
          customer_phone: string
          id?: string
          num_pilots?: number
          payment_id?: string | null
          payment_method?: string | null
          reservation_code?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          time_slot_id: string
          updated_at?: string | null
          valor_total: number
        }
        Update: {
          abandonment_notified_at?: string | null
          asaas_customer_id?: string | null
          attendance_status?: string | null
          battery_type?: Database["public"]["Enums"]["battery_type"]
          checked_in_at?: string | null
          checked_in_by?: string | null
          checkout_url?: string | null
          checkout_url_expires_at?: string | null
          created_at?: string | null
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          num_pilots?: number
          payment_id?: string | null
          payment_method?: string | null
          reservation_code?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          time_slot_id?: string
          updated_at?: string | null
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "reservations_time_slot_id_fkey"
            columns: ["time_slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      time_slots: {
        Row: {
          created_at: string | null
          date: string
          end_time: string
          id: string
          is_available: boolean | null
          max_capacity: number
          ocupados_atualmente: number
          start_time: string
          track_id: string
        }
        Insert: {
          created_at?: string | null
          date: string
          end_time: string
          id?: string
          is_available?: boolean | null
          max_capacity?: number
          ocupados_atualmente?: number
          start_time: string
          track_id: string
        }
        Update: {
          created_at?: string | null
          date?: string
          end_time?: string
          id?: string
          is_available?: boolean | null
          max_capacity?: number
          ocupados_atualmente?: number
          start_time?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_slots_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          capacity: number
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          price_kids: number
          price_per_pilot: number
        }
        Insert: {
          capacity?: number
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price_kids?: number
          price_per_pilot?: number
        }
        Update: {
          capacity?: number
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price_kids?: number
          price_per_pilot?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_message_queue: {
        Row: {
          created_at: string
          id: string
          message_text: string | null
          message_type: string
          payload: Json | null
          priority: number
          recipient_phone: string | null
          reservation_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_text?: string | null
          message_type: string
          payload?: Json | null
          priority: number
          recipient_phone?: string | null
          reservation_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          message_text?: string | null
          message_type?: string
          payload?: Json | null
          priority?: number
          recipient_phone?: string | null
          reservation_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_queue_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_send_lock: {
        Row: {
          id: boolean
          last_sent_at: string
        }
        Insert: {
          id?: boolean
          last_sent_at?: string
        }
        Update: {
          id?: boolean
          last_sent_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_whatsapp_send_slot: {
        Args: { min_gap_ms?: number }
        Returns: undefined
      }
      claim_whatsapp_batch: {
        Args: never
        Returns: {
          created_at: string
          id: string
          message_text: string | null
          message_type: string
          payload: Json | null
          priority: number
          recipient_phone: string | null
          reservation_id: string | null
          sent_at: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "whatsapp_message_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      easter_sunday: { Args: { p_year: number }; Returns: string }
      generate_future_time_slots: { Args: never; Returns: undefined }
      get_slot_availability: {
        Args: { p_date: string }
        Returns: {
          end_time: string
          is_available: boolean
          max_capacity: number
          ocupados: number
          slot_id: string
          start_time: string
          track_id: string
          track_name: string
          vagas: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      populate_holidays: { Args: { p_year: number }; Returns: undefined }
      recalc_slot_occupancy: { Args: { slot_id: string }; Returns: undefined }
      set_attendance: {
        Args: { p_id: string; p_status: string }
        Returns: undefined
      }
      set_manual_holiday: {
        Args: { p_data: string; p_descricao: string }
        Returns: undefined
      }
      unset_manual_holiday: { Args: { p_data: string }; Returns: undefined }
    }
    Enums: {
      app_role: "atendente" | "admin"
      battery_type: "individual" | "kids"
      reservation_status: "pending" | "paid" | "cancelled" | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["atendente", "admin"],
      battery_type: ["individual", "kids"],
      reservation_status: ["pending", "paid", "cancelled", "expired"],
    },
  },
} as const
A new version of Supabase CLI is available: v2.118.0 (currently installed v2.117.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
