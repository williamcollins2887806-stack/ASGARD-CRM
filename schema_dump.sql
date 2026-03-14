--
-- PostgreSQL database dump
--

\restrict TYIU94PYhVwFMUXgQbIamItn2hj5tgp9y4p4mEfdxs9xW4652uZbe0tAh5Z0dzU

-- Dumped from database version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: auto_write_off_expired(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_write_off_expired() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    eq RECORD;
    count_written_off INTEGER := 0;
    expiry_date DATE;
BEGIN
    FOR eq IN 
        SELECT * FROM equipment 
        WHERE balance_status = 'on_balance' 
          AND status != 'written_off'
          AND auto_write_off = TRUE
          AND useful_life_months IS NOT NULL
          AND balance_date IS NOT NULL
    LOOP
        expiry_date := eq.balance_date + (eq.useful_life_months || ' months')::INTERVAL;
        
        IF CURRENT_DATE >= expiry_date THEN
            UPDATE equipment SET
                status = 'written_off',
                balance_status = 'written_off',
                written_off_date = CURRENT_DATE,
                written_off_reason = 'Автосписание: истёк срок полезного использования (' || eq.useful_life_months || ' мес.)',
                book_value = COALESCE(eq.salvage_value, 0),
                updated_at = NOW()
            WHERE id = eq.id;
            
            count_written_off := count_written_off + 1;
        END IF;
    END LOOP;
    
    RETURN count_written_off;
END;
$$;


--
-- Name: calculate_depreciation(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_depreciation(equip_id integer) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    eq RECORD;
    days_in_use INTEGER;
    daily_depreciation DECIMAL;
    total_depreciation DECIMAL;
    new_book_value DECIMAL;
BEGIN
    SELECT * INTO eq FROM equipment WHERE id = equip_id;
    
    IF eq IS NULL OR eq.balance_status != 'on_balance' OR eq.purchase_price IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Дней с постановки на баланс
    days_in_use := CURRENT_DATE - COALESCE(eq.balance_date, eq.purchase_date, CURRENT_DATE);
    
    IF days_in_use <= 0 OR eq.useful_life_months IS NULL OR eq.useful_life_months <= 0 THEN
        RETURN eq.purchase_price;
    END IF;
    
    -- Дневная амортизация = (Цена - Ликвидац.стоимость) / (Срок * 30)
    daily_depreciation := (eq.purchase_price - COALESCE(eq.salvage_value, 0)) / (eq.useful_life_months * 30.0);
    
    -- Накопленная амортизация
    total_depreciation := LEAST(daily_depreciation * days_in_use, eq.purchase_price - COALESCE(eq.salvage_value, 0));
    
    -- Остаточная стоимость
    new_book_value := eq.purchase_price - total_depreciation;
    
    -- Обновляем запись
    UPDATE equipment SET
        accumulated_depreciation = total_depreciation,
        book_value = new_book_value,
        last_depreciation_date = CURRENT_DATE
    WHERE id = equip_id;
    
    RETURN new_book_value;
END;
$$;


--
-- Name: generate_inventory_number(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_inventory_number(cat_code text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  next_num INTEGER;
  result TEXT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(NULLIF(regexp_replace(inventory_number, '^[A-Z]+-', ''), '') AS INTEGER)
  ), 0) + 1
  INTO next_num
  FROM equipment
  WHERE inventory_number LIKE cat_code || '-%';

  result := cat_code || '-' || LPAD(next_num::TEXT, 5, '0');
  RETURN result;
END;
$$;


--
-- Name: generate_inventory_number(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_inventory_number(category_code character varying) RETURNS character varying
    LANGUAGE plpgsql
    AS $_$
DECLARE
    next_num INTEGER;
    year_suffix VARCHAR(2);
BEGIN
    year_suffix := TO_CHAR(CURRENT_DATE, 'YY');
    
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(inventory_number FROM '\d+$') AS INTEGER)
    ), 0) + 1 INTO next_num
    FROM equipment
    WHERE inventory_number LIKE category_code || '-' || year_suffix || '-%';
    
    RETURN category_code || '-' || year_suffix || '-' || LPAD(next_num::TEXT, 4, '0');
END;
$_$;


--
-- Name: generate_invoice_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_invoice_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    year_str TEXT;
    next_num INTEGER;
BEGIN
    year_str := EXTRACT(YEAR FROM COALESCE(NEW.created_at, NOW()))::TEXT;
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(invoice_number FROM 'СЧ-' || year_str || '-([0-9]+)') AS INTEGER)
    ), 0) + 1 INTO next_num
    FROM invoices
    WHERE invoice_number LIKE 'СЧ-' || year_str || '-%';
    NEW.invoice_number := 'СЧ-' || year_str || '-' || LPAD(next_num::TEXT, 3, '0');
    RETURN NEW;
END;
$$;


--
-- Name: generate_permit_app_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_permit_app_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    next_num INTEGER;
    year_part VARCHAR(4);
BEGIN
    year_part := TO_CHAR(NOW(), 'YYYY');

    SELECT COALESCE(MAX(
        CAST(
            SUBSTRING(number FROM '\d+$')
        AS INTEGER)
    ), 0) + 1
    INTO next_num
    FROM permit_applications
    WHERE number LIKE '%' || year_part || '-%';

    NEW.number := 'ЗР-' || year_part || '-' || LPAD(next_num::TEXT, 3, '0');
    RETURN NEW;
END;
$_$;


--
-- Name: generate_tkp_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_tkp_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    year_str TEXT;
    next_num INTEGER;
BEGIN
    year_str := EXTRACT(YEAR FROM COALESCE(NEW.created_at, NOW()))::TEXT;
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(tkp_number FROM 'ТКП-' || year_str || '-([0-9]+)') AS INTEGER)
    ), 0) + 1 INTO next_num
    FROM tkp
    WHERE tkp_number LIKE 'ТКП-' || year_str || '-%';
    NEW.tkp_number := 'ТКП-' || year_str || '-' || LPAD(next_num::TEXT, 3, '0');
    RETURN NEW;
END;
$$;


--
-- Name: get_total_book_value(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_total_book_value() RETURNS TABLE(total_purchase_price numeric, total_book_value numeric, total_depreciation numeric, equipment_count integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Сначала пересчитаем амортизацию
    PERFORM recalculate_all_depreciation();
    
    RETURN QUERY
    SELECT 
        COALESCE(SUM(e.purchase_price), 0)::DECIMAL as total_purchase_price,
        COALESCE(SUM(e.book_value), 0)::DECIMAL as total_book_value,
        COALESCE(SUM(e.accumulated_depreciation), 0)::DECIMAL as total_depreciation,
        COUNT(*)::INTEGER as equipment_count
    FROM equipment e
    WHERE e.balance_status = 'on_balance' AND e.status != 'written_off';
END;
$$;


--
-- Name: recalculate_all_depreciation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_all_depreciation() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    eq RECORD;
    count_updated INTEGER := 0;
BEGIN
    FOR eq IN SELECT id FROM equipment WHERE balance_status = 'on_balance' AND status != 'written_off'
    LOOP
        PERFORM calculate_depreciation(eq.id);
        count_updated := count_updated + 1;
    END LOOP;
    
    RETURN count_updated;
END;
$$;


--
-- Name: sync_contract_values(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_contract_values() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.contract_sum IS DISTINCT FROM OLD.contract_sum AND (NEW.contract_sum IS NOT NULL AND NEW.contract_sum > 0) THEN
    NEW.contract_value := NEW.contract_sum;
  ELSIF NEW.contract_value IS DISTINCT FROM OLD.contract_value AND (NEW.contract_value IS NOT NULL AND NEW.contract_value > 0) THEN
    NEW.contract_sum := NEW.contract_value;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (NEW.contract_sum IS NOT NULL AND NEW.contract_sum > 0) AND (NEW.contract_value IS NULL OR NEW.contract_value = 0) THEN
      NEW.contract_value := NEW.contract_sum;
    ELSIF (NEW.contract_value IS NOT NULL AND NEW.contract_value > 0) AND (NEW.contract_sum IS NULL OR NEW.contract_sum = 0) THEN
      NEW.contract_sum := NEW.contract_value;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: sync_employee_assignments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_employee_assignments() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
  elem         jsonb;
  emp_id       INTEGER;
  emp_role     VARCHAR(100);
  emp_ids      INTEGER[];
  emp_position VARCHAR(255);
BEGIN
  -- If staff_ids_json did not change on UPDATE, only handle status closure
  IF TG_OP = 'UPDATE' AND OLD.staff_ids_json IS NOT DISTINCT FROM NEW.staff_ids_json THEN
    IF OLD.work_status IS DISTINCT FROM NEW.work_status
       AND NEW.work_status IN ('Закрыт', 'Работы сдали') THEN
      UPDATE employee_assignments
      SET date_to = COALESCE(NEW.end_date_plan, NEW.end_fact, NEW.updated_at::date),
          updated_at = NOW()
      WHERE work_id = NEW.id AND date_to IS NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Collect emp_ids for the DELETE step (remove employees no longer in the list)
  emp_ids := ARRAY[]::INTEGER[];

  IF NEW.staff_ids_json IS NOT NULL
     AND NEW.staff_ids_json::text <> 'null'
     AND NEW.staff_ids_json::text <> '[]' THEN

    FOR elem IN SELECT value FROM jsonb_array_elements(NEW.staff_ids_json)
    LOOP
      -- Determine employee_id and role from the JSON element.
      -- Element can be:
      --   1) A plain integer:  5
      --   2) A string integer: "5"
      --   3) An object:        {"employee_id": 5, "role": "Мастер"}
      IF jsonb_typeof(elem) = 'number' THEN
        emp_id   := elem::text::integer;
        emp_role := NULL;
      ELSIF jsonb_typeof(elem) = 'object' THEN
        emp_id   := (elem ->> 'employee_id')::integer;
        emp_role := elem ->> 'role';
        IF emp_role IS NULL OR emp_role = '' THEN
          emp_role := elem ->> 'position';
        END IF;
      ELSIF jsonb_typeof(elem) = 'string' THEN
        IF elem #>> '{}' ~ '^[0-9]+$' THEN
          emp_id   := (elem #>> '{}')::integer;
          emp_role := NULL;
        ELSE
          CONTINUE;
        END IF;
      ELSE
        CONTINUE;
      END IF;

      -- Skip if we could not determine emp_id
      IF emp_id IS NULL THEN
        CONTINUE;
      END IF;

      emp_ids := array_append(emp_ids, emp_id);

      -- If no explicit role was provided in the JSON element,
      -- look up the employee's actual position from the employees table.
      -- Fall back to 'Сотрудник' only if the employee has no position set.
      IF emp_role IS NULL OR emp_role = '' THEN
        SELECT e.position INTO emp_position
        FROM employees e
        WHERE e.id = emp_id;

        IF emp_position IS NOT NULL AND emp_position <> '' THEN
          emp_role := emp_position;
        ELSE
          emp_role := 'Сотрудник';
        END IF;
      END IF;

      -- Insert assignment if employee exists and assignment does not already exist
      INSERT INTO employee_assignments (employee_id, work_id, role, date_from, created_at, updated_at)
      SELECT emp_id, NEW.id, emp_role,
             COALESCE(NEW.start_plan, NEW.created_at::date),
             NOW(), NOW()
      WHERE EXISTS (SELECT 1 FROM employees WHERE id = emp_id)
      AND NOT EXISTS (SELECT 1 FROM employee_assignments WHERE employee_id = emp_id AND work_id = NEW.id);

    END LOOP;
  END IF;

  -- On UPDATE, remove assignments for employees no longer in the list
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM employee_assignments
    WHERE work_id = NEW.id
    AND employee_id <> ALL(COALESCE(emp_ids, ARRAY[]::INTEGER[]));
  END IF;

  -- Close assignments when work is done
  IF NEW.work_status IN ('Закрыт', 'Работы сдали') THEN
    UPDATE employee_assignments
    SET date_to = COALESCE(NEW.end_date_plan, NEW.end_fact, NEW.updated_at::date),
        updated_at = NOW()
    WHERE work_id = NEW.id AND date_to IS NULL;
  END IF;

  RETURN NEW;
END;
$_$;


--
-- Name: update_equipment_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_equipment_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_mimir_conversation_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_mimir_conversation_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: active_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_calls (
    id integer NOT NULL,
    mango_call_id character varying(200) NOT NULL,
    mango_entry_id character varying(200),
    direction character varying(20) NOT NULL,
    from_number character varying(50),
    to_number character varying(50),
    caller_name character varying(200),
    caller_company character varying(300),
    client_inn character varying(50),
    assigned_user_id integer,
    call_state character varying(30) DEFAULT 'ringing'::character varying,
    started_at timestamp with time zone DEFAULT now(),
    connected_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: active_calls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_calls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_calls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_calls_id_seq OWNED BY public.active_calls.id;


--
-- Name: acts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acts (
    id integer NOT NULL,
    act_number character varying(50),
    act_date date,
    status character varying(20) DEFAULT 'draft'::character varying,
    work_id integer,
    customer_name character varying(255),
    customer_inn character varying(20),
    amount numeric(15,2),
    vat_pct integer DEFAULT 20,
    total_amount numeric(15,2),
    signed_date date,
    paid_date date,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by integer,
    act_type character varying(50),
    vat_amount numeric(15,2),
    file_path text,
    contract_id integer,
    description text,
    customer_id integer
);


--
-- Name: acts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acts_id_seq OWNED BY public.acts.id;


--
-- Name: ai_analysis_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analysis_log (
    id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id integer NOT NULL,
    analysis_type character varying(50) DEFAULT 'email_classification'::character varying,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    model character varying(100),
    provider character varying(30),
    duration_ms integer,
    input_preview text,
    output_json jsonb,
    error text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ai_analysis_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_analysis_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_analysis_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_analysis_log_id_seq OWNED BY public.ai_analysis_log.id;


--
-- Name: approval_payment_slips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_payment_slips (
    id integer NOT NULL,
    request_id integer NOT NULL,
    source_type character varying(50) NOT NULL,
    source_id integer NOT NULL,
    document_id integer NOT NULL,
    comment text NOT NULL,
    uploaded_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: approval_payment_slips_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.approval_payment_slips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_payment_slips_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.approval_payment_slips_id_seq OWNED BY public.approval_payment_slips.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    actor_user_id integer,
    entity_type character varying(50),
    entity_id integer,
    action character varying(50),
    details jsonb,
    created_at timestamp without time zone DEFAULT now(),
    payload_json jsonb,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: bank_classification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_classification_rules (
    id integer NOT NULL,
    pattern character varying(255) NOT NULL,
    match_field character varying(30) DEFAULT 'all'::character varying,
    direction character varying(10),
    article character varying(100) NOT NULL,
    category_1c character varying(100),
    work_id integer,
    priority integer DEFAULT 0,
    usage_count integer DEFAULT 0,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT bank_classification_rules_match_field_check CHECK (((match_field)::text = ANY (ARRAY['counterparty'::text, 'purpose'::text, 'payment_purpose'::text, 'document'::text, 'all'::text])))
);


--
-- Name: bank_classification_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bank_classification_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bank_classification_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bank_classification_rules_id_seq OWNED BY public.bank_classification_rules.id;


--
-- Name: bank_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_import_batches (
    id integer NOT NULL,
    filename character varying(255),
    source_format character varying(30),
    total_rows integer DEFAULT 0,
    new_rows integer DEFAULT 0,
    duplicate_rows integer DEFAULT 0,
    auto_classified integer DEFAULT 0,
    manual_needed integer DEFAULT 0,
    status character varying(30) DEFAULT 'pending'::character varying,
    imported_by integer,
    error_message text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT bank_import_batches_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('completed'::character varying)::text, ('error'::character varying)::text])))
);


--
-- Name: bank_import_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bank_import_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bank_import_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bank_import_batches_id_seq OWNED BY public.bank_import_batches.id;


--
-- Name: bank_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_rules (
    id integer NOT NULL,
    pattern character varying(500),
    type character varying(50),
    article character varying(100),
    counterparty character varying(500),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bank_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bank_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bank_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bank_rules_id_seq OWNED BY public.bank_rules.id;


--
-- Name: bank_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_transactions (
    id integer NOT NULL,
    import_hash character varying(100),
    external_id character varying(255),
    batch_id integer,
    transaction_date date NOT NULL,
    amount numeric(15,2) NOT NULL,
    direction character varying(10) NOT NULL,
    currency character varying(3) DEFAULT 'RUB'::character varying,
    counterparty_name character varying(500),
    counterparty_inn character varying(20),
    counterparty_kpp character varying(20),
    counterparty_account character varying(30),
    counterparty_bank_bik character varying(20),
    our_account character varying(30),
    our_bank_bik character varying(20),
    payment_purpose text,
    description text,
    document_number character varying(50),
    document_date date,
    article character varying(100),
    article_confidence character varying(20) DEFAULT 'none'::character varying,
    category_1c character varying(100),
    work_id integer,
    tender_id integer,
    linked_income_id integer,
    linked_expense_id integer,
    status character varying(30) DEFAULT 'new'::character varying,
    source_format character varying(30),
    source_filename character varying(255),
    imported_by integer,
    confirmed_by integer,
    confirmed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT bank_transactions_article_confidence_check CHECK (((article_confidence)::text = ANY (ARRAY[('high'::character varying)::text, ('medium'::character varying)::text, ('low'::character varying)::text, ('none'::character varying)::text, ('manual'::character varying)::text]))),
    CONSTRAINT bank_transactions_direction_check CHECK (((direction)::text = ANY (ARRAY[('income'::character varying)::text, ('expense'::character varying)::text]))),
    CONSTRAINT bank_transactions_status_check CHECK (((status)::text = ANY (ARRAY[('new'::character varying)::text, ('classified'::character varying)::text, ('confirmed'::character varying)::text, ('distributed'::character varying)::text, ('exported_1c'::character varying)::text, ('skipped'::character varying)::text])))
);


--
-- Name: bank_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bank_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bank_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bank_transactions_id_seq OWNED BY public.bank_transactions.id;


--
-- Name: bonus_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonus_requests (
    id integer NOT NULL,
    work_id integer,
    pm_id integer,
    employee_id integer,
    amount numeric(15,2),
    reason text,
    status character varying(50) DEFAULT 'pending'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    comment text,
    pm_name character varying(255),
    work_title character varying(500),
    total_amount numeric(15,2),
    currency character varying(10) DEFAULT 'RUB'::character varying,
    director_comment text,
    processed_by integer,
    processed_at timestamp without time zone,
    bonuses jsonb DEFAULT '[]'::jsonb,
    bonuses_json jsonb,
    decided_at timestamp without time zone,
    decided_by_user_id integer
);


--
-- Name: bonus_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bonus_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bonus_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bonus_requests_id_seq OWNED BY public.bonus_requests.id;


--
-- Name: business_trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_trips (
    id integer NOT NULL,
    inspection_id integer,
    work_id integer,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    date_from date,
    date_to date,
    employees_json jsonb DEFAULT '[]'::jsonb,
    transport_type character varying(50),
    need_fuel_card boolean DEFAULT false,
    need_air_ticket boolean DEFAULT false,
    need_advance boolean DEFAULT false,
    advance_amount numeric(15,2),
    ticket_details text,
    cash_request_id integer,
    expense_ids jsonb DEFAULT '[]'::jsonb,
    author_id integer,
    sent_to_office_manager boolean DEFAULT false,
    office_manager_notified_at timestamp without time zone,
    approved_by integer,
    approved_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: business_trips_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.business_trips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: business_trips_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.business_trips_id_seq OWNED BY public.business_trips.id;


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id integer NOT NULL,
    date date NOT NULL,
    "time" character varying(10),
    type character varying(50) DEFAULT 'meeting'::character varying,
    title character varying(500) NOT NULL,
    description text,
    participants text,
    reminder_minutes integer DEFAULT 30,
    reminder_sent boolean DEFAULT false,
    tender_id integer,
    work_id integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    all_day boolean DEFAULT false,
    location character varying(255),
    color character varying(20),
    status character varying(50) DEFAULT 'scheduled'::character varying,
    notes text,
    dates_json jsonb,
    confirmed_at timestamp without time zone,
    end_date date,
    end_time time without time zone,
    is_all_day boolean DEFAULT false,
    recurrence text
);


--
-- Name: calendar_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calendar_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calendar_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calendar_events_id_seq OWNED BY public.calendar_events.id;


--
-- Name: call_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_history (
    call_id character varying(100) NOT NULL,
    caller_number character varying(50),
    called_number character varying(50),
    direction character varying(20),
    status character varying(50),
    duration integer,
    recording_url text,
    "timestamp" timestamp without time zone,
    user_id integer,
    customer_id character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    id integer NOT NULL,
    mango_entry_id character varying(200),
    mango_call_id character varying(200),
    from_number character varying(50),
    to_number character varying(50),
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_seconds integer,
    call_type character varying(20) DEFAULT 'inbound'::character varying,
    record_path text,
    recording_id character varying(200),
    transcript text,
    transcript_status character varying(20) DEFAULT 'none'::character varying,
    transcript_segments jsonb,
    ai_summary text,
    ai_is_target boolean,
    ai_lead_data jsonb,
    ai_sentiment character varying(20),
    lead_id integer,
    client_inn character varying(50),
    dadata_region character varying(150),
    dadata_operator character varying(150),
    dadata_city character varying(150),
    missed_task_id integer,
    missed_acknowledged boolean DEFAULT false,
    missed_callback_at timestamp with time zone,
    webhook_payload jsonb,
    line_number character varying(50),
    disconnect_reason character varying(100),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: call_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.call_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: call_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.call_history_id_seq OWNED BY public.call_history.id;


--
-- Name: call_routing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_routing_rules (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    priority integer DEFAULT 0,
    condition_type character varying(50) NOT NULL,
    condition_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    action_type character varying(50) NOT NULL,
    action_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: call_routing_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.call_routing_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: call_routing_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.call_routing_rules_id_seq OWNED BY public.call_routing_rules.id;


--
-- Name: cash_balance_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_balance_log (
    id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    change_amount numeric(15,2),
    change_type character varying(50),
    description text,
    related_request_id integer,
    user_id integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: cash_balance_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_balance_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_balance_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_balance_log_id_seq OWNED BY public.cash_balance_log.id;


--
-- Name: cash_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_expenses (
    id integer NOT NULL,
    request_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    description text NOT NULL,
    receipt_file character varying(255),
    receipt_original_name character varying(255),
    expense_date date DEFAULT CURRENT_DATE,
    created_at timestamp without time zone DEFAULT now(),
    category character varying(50) DEFAULT 'other'::character varying,
    CONSTRAINT cash_expenses_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: cash_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_expenses_id_seq OWNED BY public.cash_expenses.id;


--
-- Name: cash_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_messages (
    id integer NOT NULL,
    request_id integer NOT NULL,
    user_id integer NOT NULL,
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: cash_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_messages_id_seq OWNED BY public.cash_messages.id;


--
-- Name: cash_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_requests (
    id integer NOT NULL,
    user_id integer NOT NULL,
    work_id integer,
    type character varying(20) DEFAULT 'advance'::character varying NOT NULL,
    amount numeric(12,2) NOT NULL,
    purpose text NOT NULL,
    cover_letter text,
    status character varying(20) DEFAULT 'requested'::character varying NOT NULL,
    director_id integer,
    director_comment text,
    received_at timestamp without time zone,
    closed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    issued_by integer,
    issued_at timestamp without time zone,
    receipt_deadline timestamp without time zone,
    overdue_notified boolean DEFAULT false,
    CONSTRAINT cash_requests_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: cash_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_requests_id_seq OWNED BY public.cash_requests.id;


--
-- Name: cash_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_returns (
    id integer NOT NULL,
    request_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    note text,
    confirmed_by integer,
    confirmed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT cash_returns_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: cash_returns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_returns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_returns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_returns_id_seq OWNED BY public.cash_returns.id;


--
-- Name: chat_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_attachments (
    id integer NOT NULL,
    message_id integer NOT NULL,
    filename character varying(255) NOT NULL,
    original_name character varying(255) NOT NULL,
    mime_type character varying(100),
    size_bytes integer,
    uploaded_at timestamp without time zone DEFAULT now()
);


--
-- Name: chat_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_attachments_id_seq OWNED BY public.chat_attachments.id;


--
-- Name: chat_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_group_members (
    id integer NOT NULL,
    chat_id integer NOT NULL,
    user_id integer NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying,
    muted_until timestamp without time zone,
    last_read_at timestamp without time zone,
    joined_at timestamp without time zone DEFAULT now()
);


--
-- Name: chat_group_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_group_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_group_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_group_members_id_seq OWNED BY public.chat_group_members.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    chat_id integer,
    user_id integer,
    message text,
    attachments_json text,
    is_read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    chat_type character varying(50) DEFAULT 'general'::character varying,
    sender_id integer,
    sender_name character varying(255),
    text text,
    "timestamp" timestamp without time zone DEFAULT now(),
    read_by jsonb DEFAULT '[]'::jsonb,
    entity_id integer,
    entity_title text,
    to_user_id integer,
    user_name character varying(255),
    user_role character varying(50),
    attachments jsonb DEFAULT '[]'::jsonb,
    mentions jsonb DEFAULT '[]'::jsonb,
    is_system boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now(),
    read_at timestamp without time zone,
    entity_type text,
    created_by integer,
    reply_to_id integer,
    edited_at timestamp without time zone,
    deleted_at timestamp without time zone,
    reactions jsonb DEFAULT '{}'::jsonb,
    reply_to integer,
    attachment_path text,
    attachment_name text
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chats (
    id integer NOT NULL,
    type character varying(50),
    name character varying(200),
    entity_type character varying(50),
    entity_id integer,
    participants_json text,
    updated_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    is_group boolean DEFAULT false,
    avatar character varying(255),
    description text,
    is_readonly boolean DEFAULT false,
    archived_at timestamp without time zone,
    last_message_at timestamp without time zone,
    message_count integer DEFAULT 0,
    avatar_path text
);


--
-- Name: chats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chats_id_seq OWNED BY public.chats.id;


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id integer NOT NULL,
    number character varying(100),
    type character varying(50),
    counterparty_id character varying(50),
    counterparty_name character varying(500),
    subject text,
    amount numeric(15,2),
    start_date date,
    end_date date,
    status character varying(50) DEFAULT 'active'::character varying,
    file_path text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    tender_id integer,
    work_id integer,
    is_perpetual boolean DEFAULT false,
    is_indefinite boolean DEFAULT false,
    vat_pct integer DEFAULT 20,
    signed_date date,
    customer_inn character varying(20),
    customer_name character varying(500),
    comment text,
    currency character varying(10) DEFAULT 'RUB'::character varying,
    file_url text,
    responsible character varying(255)
);


--
-- Name: contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contracts_id_seq OWNED BY public.contracts.id;


--
-- Name: correspondence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.correspondence (
    id integer NOT NULL,
    direction character varying(20) NOT NULL,
    date date,
    number character varying(100),
    counterparty character varying(500),
    subject text,
    content text,
    tender_id integer,
    work_id integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    doc_type character varying(50),
    file_path text,
    status character varying(50),
    contact_person character varying(255),
    note text,
    email_id integer,
    customer_id integer,
    body text,
    linked_inbox_application_id integer
);


--
-- Name: correspondence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.correspondence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: correspondence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.correspondence_id_seq OWNED BY public.correspondence.id;


--
-- Name: correspondence_outgoing_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.correspondence_outgoing_counters (
    period_key character varying(7) NOT NULL,
    last_number integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: correspondence_outgoing_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.correspondence_outgoing_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_reviews (
    id integer NOT NULL,
    work_id integer,
    pm_id integer,
    customer_id character varying(50),
    rating integer,
    comment text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: customer_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_reviews_id_seq OWNED BY public.customer_reviews.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    inn character varying(30),
    name character varying(500) NOT NULL,
    full_name character varying(1000),
    address character varying(1000),
    phone character varying(100),
    email character varying(255),
    contact_person character varying(255),
    category character varying(100),
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    id integer NOT NULL,
    kpp character varying(20),
    city character varying(255),
    note text,
    ogrn character varying(20),
    contacts_json text,
    last_review_at timestamp without time zone,
    legal_address character varying(1000)
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: doc_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_sets (
    id integer NOT NULL,
    tender_id integer,
    work_id integer,
    name character varying(200),
    status character varying(50),
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: doc_sets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.doc_sets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: doc_sets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.doc_sets_id_seq OWNED BY public.doc_sets.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id integer NOT NULL,
    filename character varying(255) NOT NULL,
    original_name character varying(500),
    mime_type character varying(100),
    size integer,
    type character varying(100),
    tender_id integer,
    work_id integer,
    uploaded_by integer,
    created_at timestamp without time zone DEFAULT now(),
    category character varying(100),
    description text,
    employee_id integer,
    updated_at timestamp without time zone DEFAULT now(),
    file_url text,
    download_url text,
    uploaded_by_user_id integer
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_accounts (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    email_address character varying(255) NOT NULL,
    account_type character varying(50) DEFAULT 'primary'::character varying,
    imap_host character varying(255),
    imap_port integer DEFAULT 993,
    imap_user character varying(255),
    imap_pass_encrypted text,
    imap_tls boolean DEFAULT true,
    imap_folder character varying(255) DEFAULT 'INBOX'::character varying,
    smtp_host character varying(255),
    smtp_port integer DEFAULT 587,
    smtp_user character varying(255),
    smtp_pass_encrypted text,
    smtp_tls boolean DEFAULT true,
    smtp_from_name character varying(255) DEFAULT 'ООО «Асгард Сервис»'::character varying,
    sync_enabled boolean DEFAULT true,
    sync_interval_sec integer DEFAULT 120,
    sync_max_emails integer DEFAULT 200,
    last_sync_at timestamp without time zone,
    last_sync_uid integer DEFAULT 0,
    last_sync_error text,
    is_active boolean DEFAULT true,
    is_copy_target boolean DEFAULT false,
    exclude_from_inbox boolean DEFAULT false,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: email_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_accounts_id_seq OWNED BY public.email_accounts.id;


--
-- Name: email_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_attachments (
    id integer NOT NULL,
    email_id integer NOT NULL,
    filename character varying(500) NOT NULL,
    original_filename character varying(500),
    mime_type character varying(255) DEFAULT 'application/octet-stream'::character varying,
    size bigint DEFAULT 0,
    file_path text NOT NULL,
    content_id character varying(500),
    content_disposition character varying(50),
    is_inline boolean DEFAULT false,
    checksum_sha256 character varying(64),
    thumbnail_path text,
    ai_content_type character varying(100),
    ai_extracted_text text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: email_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_attachments_id_seq OWNED BY public.email_attachments.id;


--
-- Name: email_classification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_classification_rules (
    id integer NOT NULL,
    rule_type character varying(50) NOT NULL,
    pattern character varying(500) NOT NULL,
    match_mode character varying(20) DEFAULT 'contains'::character varying,
    classification character varying(50) NOT NULL,
    confidence integer DEFAULT 80,
    priority integer DEFAULT 0,
    is_active boolean DEFAULT true,
    description character varying(500),
    times_matched integer DEFAULT 0,
    last_matched_at timestamp without time zone,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT email_classification_rules_classification_check CHECK (((classification)::text = ANY (ARRAY['direct_request'::text, 'platform_tender'::text, 'newsletter'::text, 'internal'::text, 'spam'::text, 'test'::text, 'other'::text, 'custom'::text]))),
    CONSTRAINT email_classification_rules_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100))),
    CONSTRAINT email_classification_rules_match_mode_check CHECK (((match_mode)::text = ANY (ARRAY[('exact'::character varying)::text, ('contains'::character varying)::text, ('regex'::character varying)::text, ('starts_with'::character varying)::text, ('ends_with'::character varying)::text]))),
    CONSTRAINT email_classification_rules_rule_type_check CHECK (((rule_type)::text = ANY (ARRAY['domain'::text, 'keyword_subject'::text, 'keyword_body'::text, 'header'::text, 'from_pattern'::text, 'combined'::text, 'subject'::text, 'body'::text, 'sender'::text])))
);


--
-- Name: email_classification_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_classification_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_classification_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_classification_rules_id_seq OWNED BY public.email_classification_rules.id;


--
-- Name: email_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_folders (
    id integer NOT NULL,
    user_account_id integer,
    account_id integer,
    name character varying(255) NOT NULL,
    imap_path character varying(255),
    folder_type character varying(50) DEFAULT 'custom'::character varying,
    unread_count integer DEFAULT 0,
    total_count integer DEFAULT 0,
    color character varying(20),
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: email_folders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_folders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_folders_id_seq OWNED BY public.email_folders.id;


--
-- Name: email_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_history (
    id integer NOT NULL,
    recipient character varying(255),
    subject character varying(255),
    body text,
    status character varying(20) DEFAULT 'sent'::character varying,
    sent_at timestamp without time zone DEFAULT now(),
    error_message text
);


--
-- Name: email_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_history_id_seq OWNED BY public.email_history.id;


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_log (
    id integer NOT NULL,
    user_id integer,
    to_email character varying(255),
    subject character varying(500),
    status character varying(50),
    message_id character varying(255),
    error text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: email_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_log_id_seq OWNED BY public.email_log.id;


--
-- Name: email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_queue (
    id integer NOT NULL,
    recipient character varying(255),
    subject character varying(255),
    body text,
    scheduled_for timestamp without time zone,
    attempts integer DEFAULT 0,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: email_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_queue_id_seq OWNED BY public.email_queue.id;


--
-- Name: email_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_sync_log (
    id integer NOT NULL,
    account_id integer,
    sync_type character varying(50) NOT NULL,
    status character varying(50) DEFAULT 'running'::character varying NOT NULL,
    emails_fetched integer DEFAULT 0,
    emails_new integer DEFAULT 0,
    emails_updated integer DEFAULT 0,
    attachments_saved integer DEFAULT 0,
    errors_count integer DEFAULT 0,
    error_details jsonb DEFAULT '[]'::jsonb,
    duration_ms integer,
    started_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    CONSTRAINT email_sync_log_status_check CHECK (((status)::text = ANY (ARRAY[('running'::character varying)::text, ('success'::character varying)::text, ('error'::character varying)::text, ('partial'::character varying)::text]))),
    CONSTRAINT email_sync_log_sync_type_check CHECK (((sync_type)::text = ANY (ARRAY[('initial'::character varying)::text, ('incremental'::character varying)::text, ('manual'::character varying)::text, ('idle_push'::character varying)::text])))
);


--
-- Name: email_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_sync_log_id_seq OWNED BY public.email_sync_log.id;


--
-- Name: email_templates_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates_v2 (
    id integer NOT NULL,
    code character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100) DEFAULT 'custom'::character varying,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    variables_schema jsonb DEFAULT '[]'::jsonb,
    use_letterhead boolean DEFAULT false,
    default_cc text,
    auto_attach_files jsonb DEFAULT '[]'::jsonb,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT email_templates_v2_category_check CHECK (((category)::text = ANY (ARRAY[('document'::character varying)::text, ('tender'::character varying)::text, ('notification'::character varying)::text, ('finance'::character varying)::text, ('hr'::character varying)::text, ('custom'::character varying)::text])))
);


--
-- Name: email_templates_v2_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_templates_v2_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_templates_v2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_templates_v2_id_seq OWNED BY public.email_templates_v2.id;


--
-- Name: emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emails (
    id integer NOT NULL,
    account_id integer,
    direction character varying(10) DEFAULT 'inbound'::character varying NOT NULL,
    message_id character varying(998),
    in_reply_to character varying(998),
    references_header text,
    thread_id character varying(255),
    from_email character varying(255),
    from_name character varying(255),
    to_emails jsonb DEFAULT '[]'::jsonb,
    cc_emails jsonb DEFAULT '[]'::jsonb,
    bcc_emails jsonb DEFAULT '[]'::jsonb,
    reply_to_email character varying(255),
    subject text,
    body_text text,
    body_html text,
    body_html_raw text,
    snippet character varying(300),
    email_type character varying(50) DEFAULT 'unknown'::character varying,
    classification_confidence integer DEFAULT 0,
    classification_rule_id integer,
    is_read boolean DEFAULT false,
    is_starred boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    is_spam boolean DEFAULT false,
    is_draft boolean DEFAULT false,
    linked_tender_id integer,
    linked_work_id integer,
    linked_customer_inn character varying(20),
    linked_entities jsonb DEFAULT '{}'::jsonb,
    has_attachments boolean DEFAULT false,
    attachment_count integer DEFAULT 0,
    total_attachments_size bigint DEFAULT 0,
    imap_uid integer,
    imap_folder character varying(255) DEFAULT 'INBOX'::character varying,
    imap_flags text,
    raw_headers text,
    sent_by_user_id integer,
    template_id integer,
    reply_to_email_id integer,
    forward_of_email_id integer,
    ai_summary text,
    ai_classification text,
    ai_color character varying(20),
    ai_recommendation text,
    ai_processed_at timestamp without time zone,
    email_date timestamp without time zone DEFAULT now() NOT NULL,
    synced_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    pre_tender_id integer,
    user_account_id integer,
    owner_user_id integer,
    folder_id integer,
    is_crm_copy boolean DEFAULT false,
    CONSTRAINT emails_direction_check CHECK (((direction)::text = ANY (ARRAY[('inbound'::character varying)::text, ('outbound'::character varying)::text]))),
    CONSTRAINT emails_email_type_check CHECK (((email_type)::text = ANY (ARRAY[('direct_request'::character varying)::text, ('platform_tender'::character varying)::text, ('newsletter'::character varying)::text, ('internal'::character varying)::text, ('crm_outbound'::character varying)::text, ('unknown'::character varying)::text])))
);


--
-- Name: emails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emails_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emails_id_seq OWNED BY public.emails.id;


--
-- Name: employee_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_assignments (
    id integer NOT NULL,
    employee_id integer,
    work_id integer,
    date_from date,
    date_to date,
    role character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: employee_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_assignments_id_seq OWNED BY public.employee_assignments.id;


--
-- Name: employee_collection_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_collection_items (
    id integer NOT NULL,
    collection_id integer NOT NULL,
    employee_id integer NOT NULL,
    added_by integer,
    added_at timestamp without time zone DEFAULT now()
);


--
-- Name: employee_collection_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_collection_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_collection_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_collection_items_id_seq OWNED BY public.employee_collection_items.id;


--
-- Name: employee_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_collections (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_by integer,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: employee_collections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_collections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_collections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_collections_id_seq OWNED BY public.employee_collections.id;


--
-- Name: employee_permits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_permits (
    id integer NOT NULL,
    employee_id integer,
    type_id integer,
    permit_type character varying(100),
    permit_number character varying(100),
    issue_date date,
    expiry_date date,
    file_path text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    category character varying(100),
    doc_number character varying(100),
    file_url text,
    issuer character varying(255),
    status character varying(50) DEFAULT 'active'::character varying,
    scan_file character varying(255),
    scan_original_name character varying(255),
    notify_30_sent boolean DEFAULT false,
    notify_14_sent boolean DEFAULT false,
    notify_expired_sent boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_by integer,
    renewal_of integer,
    notes text
);


--
-- Name: employee_permits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_permits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_permits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_permits_id_seq OWNED BY public.employee_permits.id;


--
-- Name: employee_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_plan (
    id integer NOT NULL,
    employee_id integer,
    date date NOT NULL,
    status character varying(50),
    work_id integer,
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    kind character varying(50),
    note text,
    updated_at timestamp without time zone DEFAULT now(),
    staff_id integer,
    user_id integer,
    status_code character varying(10),
    object_name character varying(500),
    shift_type character varying(50),
    hours numeric(6,2),
    notes text,
    source character varying(50),
    staff_request_id integer,
    locked boolean DEFAULT false
);


--
-- Name: employee_plan_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_plan_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_plan_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_plan_id_seq OWNED BY public.employee_plan.id;


--
-- Name: employee_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_rates (
    id integer NOT NULL,
    employee_id integer,
    role_tag character varying(100),
    day_rate numeric(12,2) NOT NULL,
    shift_rate numeric(12,2),
    overtime_rate numeric(12,2),
    effective_from date DEFAULT CURRENT_DATE,
    effective_to date,
    comment text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: employee_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_rates_id_seq OWNED BY public.employee_rates.id;


--
-- Name: employee_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_reviews (
    id integer NOT NULL,
    employee_id integer,
    work_id integer,
    pm_id integer,
    rating integer,
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT employee_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 10)))
);


--
-- Name: employee_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_reviews_id_seq OWNED BY public.employee_reviews.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    fio character varying(255) NOT NULL,
    phone character varying(100),
    email character varying(255),
    role_tag character varying(100),
    skills text[],
    rating_avg numeric(4,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    user_id integer,
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    city character varying(255),
    "position" character varying(255),
    full_name character varying(255),
    passport_data text,
    inn character varying(20),
    snils character varying(20),
    birth_date date,
    address text,
    employment_date date,
    dismissal_date date,
    salary numeric(15,2),
    rate numeric(15,2),
    gender character varying(10),
    grade character varying(50),
    hire_date date,
    pass_series character varying(10),
    pass_number character varying(20),
    imt_number character varying(50),
    imt_expires date,
    permits jsonb,
    rating_count integer DEFAULT 0,
    docs_url text,
    is_self_employed boolean DEFAULT false,
    bank_name text,
    bik character varying(20),
    account_number character varying(30),
    card_number character varying(20),
    passport_series character varying(10),
    passport_number character varying(10),
    day_rate numeric(12,2),
    contract_type character varying(30) DEFAULT 'labor'::character varying,
    department character varying(100),
    registration_address text,
    birth_place text,
    passport_date text,
    passport_issued text,
    passport_code text,
    naks text,
    naks_number character varying(100),
    naks_stamp character varying(20),
    naks_date date,
    naks_expiry date,
    fsb_pass text,
    score_index character varying(50),
    qualification_name text,
    qualification_grade character varying(50),
    brigade character varying(100),
    notes text
);


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment (
    id integer NOT NULL,
    inventory_number character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    category_id integer,
    serial_number character varying(100),
    barcode character varying(100),
    qr_code text,
    qr_uuid character varying(36),
    purchase_price numeric(15,2),
    purchase_date date,
    invoice_id integer,
    balance_date date,
    balance_status character varying(20) DEFAULT 'pending'::character varying,
    useful_life_months integer DEFAULT 60,
    salvage_value numeric(15,2) DEFAULT 0,
    depreciation_method character varying(20) DEFAULT 'linear'::character varying,
    accumulated_depreciation numeric(15,2) DEFAULT 0,
    book_value numeric(15,2),
    last_depreciation_date date,
    auto_write_off boolean DEFAULT true,
    status character varying(30) DEFAULT 'on_warehouse'::character varying,
    condition character varying(20) DEFAULT 'good'::character varying,
    quantity numeric(15,3) DEFAULT 1,
    unit character varying(20) DEFAULT 'шт'::character varying,
    warranty_end date,
    next_maintenance date,
    next_calibration date,
    maintenance_interval_days integer,
    warehouse_id integer,
    current_holder_id integer,
    current_object_id integer,
    brand character varying(100),
    model character varying(100),
    specifications jsonb,
    notes text,
    photos text[],
    written_off_date date,
    written_off_reason text,
    written_off_by integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    description text,
    location character varying(255),
    is_active boolean DEFAULT true,
    comment text,
    holder_id integer,
    object_id integer,
    work_id integer,
    photo_url text,
    kit_id integer,
    min_stock_level integer DEFAULT 0,
    reorder_point integer DEFAULT 0,
    custom_icon text
);


--
-- Name: equipment_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_categories (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(20),
    parent_id integer,
    icon character varying(10),
    requires_calibration boolean DEFAULT false,
    is_consumable boolean DEFAULT false,
    description text,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: equipment_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_categories_id_seq OWNED BY public.equipment_categories.id;


--
-- Name: equipment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_id_seq OWNED BY public.equipment.id;


--
-- Name: equipment_kit_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_kit_items (
    id integer NOT NULL,
    kit_id integer NOT NULL,
    equipment_id integer,
    category_id integer,
    item_name character varying(200),
    quantity integer DEFAULT 1,
    is_required boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: equipment_kit_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_kit_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_kit_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_kit_items_id_seq OWNED BY public.equipment_kit_items.id;


--
-- Name: equipment_kits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_kits (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    code character varying(50),
    description text,
    work_type character varying(100),
    icon character varying(10) DEFAULT '🧰'::character varying,
    photo_url text,
    is_template boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: equipment_kits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_kits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_kits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_kits_id_seq OWNED BY public.equipment_kits.id;


--
-- Name: equipment_maintenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_maintenance (
    id integer NOT NULL,
    equipment_id integer,
    maintenance_type character varying(30) NOT NULL,
    description text,
    cost numeric(15,2),
    spare_parts jsonb,
    performed_by character varying(255),
    contractor character varying(255),
    started_at date,
    completed_at date,
    next_date date,
    invoice_id integer,
    notes text,
    photos text[],
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: equipment_maintenance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_maintenance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_maintenance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_maintenance_id_seq OWNED BY public.equipment_maintenance.id;


--
-- Name: equipment_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_movements (
    id integer NOT NULL,
    equipment_id integer,
    movement_type character varying(30) NOT NULL,
    from_warehouse_id integer,
    from_holder_id integer,
    from_object_id integer,
    to_warehouse_id integer,
    to_holder_id integer,
    to_object_id integer,
    work_id integer,
    quantity numeric(15,3) DEFAULT 1,
    condition_before character varying(20),
    condition_after character varying(20),
    document_number character varying(50),
    photos_before text[],
    photos_after text[],
    notes text,
    confirmed boolean DEFAULT false,
    confirmed_by integer,
    confirmed_at timestamp without time zone,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    verification_photos text[],
    checklist jsonb
);


--
-- Name: equipment_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_movements_id_seq OWNED BY public.equipment_movements.id;


--
-- Name: equipment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_requests (
    id integer NOT NULL,
    request_type character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    requester_id integer,
    equipment_id integer,
    quantity numeric(15,3) DEFAULT 1,
    work_id integer,
    object_id integer,
    target_holder_id integer,
    needed_from date,
    needed_to date,
    notes text,
    processed_by integer,
    processed_at timestamp without time zone,
    rejection_reason text,
    created_at timestamp without time zone DEFAULT now(),
    reason text,
    updated_at timestamp without time zone DEFAULT now(),
    urgency character varying(20)
);


--
-- Name: equipment_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_requests_id_seq OWNED BY public.equipment_requests.id;


--
-- Name: equipment_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_reservations (
    id integer NOT NULL,
    equipment_id integer,
    work_id integer,
    reserved_by integer,
    reserved_from date NOT NULL,
    reserved_to date NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: equipment_reservations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_reservations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_reservations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_reservations_id_seq OWNED BY public.equipment_reservations.id;


--
-- Name: equipment_work_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_work_assignments (
    id integer NOT NULL,
    equipment_id integer NOT NULL,
    work_id integer NOT NULL,
    assigned_by integer,
    assigned_at timestamp without time zone DEFAULT now(),
    returned_at timestamp without time zone,
    condition_on_assign character varying(50),
    condition_on_return character varying(50),
    photo_assign text[],
    photo_return text[],
    notes text,
    status character varying(30) DEFAULT 'active'::character varying
);


--
-- Name: equipment_work_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_work_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_work_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_work_assignments_id_seq OWNED BY public.equipment_work_assignments.id;


--
-- Name: erp_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_connections (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    erp_type character varying(50) NOT NULL,
    connection_url text,
    auth_type character varying(30) DEFAULT 'basic'::character varying,
    auth_credentials_encrypted text,
    is_active boolean DEFAULT true,
    sync_direction character varying(20) DEFAULT 'both'::character varying,
    last_sync_at timestamp without time zone,
    last_sync_status character varying(30),
    last_sync_error text,
    sync_interval_minutes integer DEFAULT 60,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    webhook_secret character varying(128),
    CONSTRAINT erp_connections_auth_type_check CHECK (((auth_type)::text = ANY (ARRAY[('basic'::character varying)::text, ('token'::character varying)::text, ('oauth2'::character varying)::text, ('certificate'::character varying)::text]))),
    CONSTRAINT erp_connections_erp_type_check CHECK (((erp_type)::text = ANY (ARRAY[('1c'::character varying)::text, ('sap'::character varying)::text, ('galaxy'::character varying)::text, ('custom'::character varying)::text]))),
    CONSTRAINT erp_connections_sync_direction_check CHECK (((sync_direction)::text = ANY (ARRAY[('import'::character varying)::text, ('export'::character varying)::text, ('both'::character varying)::text])))
);


--
-- Name: COLUMN erp_connections.webhook_secret; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.erp_connections.webhook_secret IS 'HMAC-SHA256 secret for webhook signature validation';


--
-- Name: erp_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erp_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erp_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erp_connections_id_seq OWNED BY public.erp_connections.id;


--
-- Name: erp_field_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_field_mappings (
    id integer NOT NULL,
    connection_id integer,
    entity_type character varying(50) NOT NULL,
    crm_field character varying(100) NOT NULL,
    erp_field character varying(100) NOT NULL,
    transform_rule character varying(255),
    is_required boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: erp_field_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erp_field_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erp_field_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erp_field_mappings_id_seq OWNED BY public.erp_field_mappings.id;


--
-- Name: erp_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_sync_log (
    id integer NOT NULL,
    connection_id integer,
    direction character varying(10) NOT NULL,
    entity_type character varying(50) NOT NULL,
    records_total integer DEFAULT 0,
    records_success integer DEFAULT 0,
    records_failed integer DEFAULT 0,
    error_details jsonb DEFAULT '[]'::jsonb,
    started_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    status character varying(30) DEFAULT 'running'::character varying,
    initiated_by integer,
    CONSTRAINT erp_sync_log_direction_check CHECK (((direction)::text = ANY (ARRAY[('import'::character varying)::text, ('export'::character varying)::text]))),
    CONSTRAINT erp_sync_log_status_check CHECK (((status)::text = ANY (ARRAY[('running'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: erp_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erp_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erp_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erp_sync_log_id_seq OWNED BY public.erp_sync_log.id;


--
-- Name: estimate_approval_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estimate_approval_events (
    id integer NOT NULL,
    request_id integer NOT NULL,
    estimate_id integer NOT NULL,
    action character varying(50) NOT NULL,
    from_stage character varying(50),
    to_stage character varying(50) NOT NULL,
    actor_id integer,
    actor_role character varying(50),
    comment text,
    payload_json jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: estimate_approval_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estimate_approval_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estimate_approval_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estimate_approval_events_id_seq OWNED BY public.estimate_approval_events.id;


--
-- Name: estimate_approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estimate_approval_requests (
    id integer NOT NULL,
    estimate_id integer NOT NULL,
    tender_id integer,
    requested_by integer NOT NULL,
    pm_id integer,
    estimate_version_no integer,
    current_stage character varying(50) NOT NULL,
    last_rework_kind character varying(20),
    submitted_snapshot_json jsonb NOT NULL,
    submitted_at timestamp without time zone DEFAULT now() NOT NULL,
    last_action_at timestamp without time zone DEFAULT now() NOT NULL,
    last_actor_id integer,
    last_comment text,
    finalized_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    requires_payment boolean DEFAULT false NOT NULL,
    source_type character varying(50),
    source_id integer
);


--
-- Name: estimate_approval_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estimate_approval_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estimate_approval_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estimate_approval_requests_id_seq OWNED BY public.estimate_approval_requests.id;


--
-- Name: estimates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estimates (
    id integer NOT NULL,
    tender_id integer,
    pm_id integer,
    approval_status character varying(100) DEFAULT 'draft'::character varying,
    total_sum numeric(15,2),
    cost_sum numeric(15,2),
    margin_percent numeric(5,2),
    deadline date,
    work_days integer,
    comment text,
    calc_data jsonb,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    version integer DEFAULT 1,
    is_approved boolean DEFAULT false,
    approved_by integer,
    approved_at timestamp without time zone,
    status character varying(50),
    city character varying(255),
    distance_km integer,
    people_count integer,
    work_type character varying(100),
    vat_pct integer DEFAULT 20,
    price_tkp numeric(15,2),
    cost_plan numeric(15,2),
    work_start_plan date,
    work_end_plan date,
    version_no integer DEFAULT 1,
    calc_summary_json jsonb,
    quick_calc_json jsonb,
    payload_json jsonb,
    sent_for_approval_at timestamp without time zone,
    approval_comment text,
    reject_reason text,
    user_id integer,
    probability_pct integer DEFAULT 50,
    payment_terms text,
    calc_v2_json jsonb,
    profit_per_day numeric(15,2),
    price_with_vat numeric(15,2),
    decided_at timestamp without time zone,
    cover_letter text,
    assumptions text,
    margin_pct numeric(5,2),
    overhead_pct numeric(5,2),
    fot_tax_pct numeric(5,2),
    profit_tax_pct numeric(5,2),
    consumables_pct numeric(5,2),
    decided_by_user_id integer,
    items_json jsonb,
    staff_ids_json jsonb,
    proposed_staff_ids_json jsonb,
    approved_staff_ids_json jsonb,
    proposed_staff_ids_a_json jsonb,
    proposed_staff_ids_b_json jsonb,
    approved_staff_ids_a_json jsonb,
    approved_staff_ids_b_json jsonb,
    work_id integer,
    estimate_data_json jsonb,
    title character varying(500),
    description text,
    amount numeric(15,2),
    cost numeric(15,2),
    margin numeric(15,2),
    notes text,
    customer character varying(500),
    object_name character varying(500),
    priority character varying(30)
);


--
-- Name: estimates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estimates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estimates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estimates_id_seq OWNED BY public.estimates.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    user_id integer,
    work_id integer,
    category text,
    amount numeric(15,2),
    description text,
    status text DEFAULT 'pending'::text,
    approved_at timestamp without time zone,
    rejected_at timestamp without time zone,
    processed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: hr_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_requests (
    id integer NOT NULL,
    user_id integer,
    type text,
    status text DEFAULT 'pending'::text,
    request_json jsonb,
    comment text,
    decided_at timestamp without time zone,
    decided_by_user_id integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: hr_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hr_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hr_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hr_requests_id_seq OWNED BY public.hr_requests.id;


--
-- Name: inbox_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_applications (
    id integer NOT NULL,
    email_id integer,
    source character varying(50) DEFAULT 'email'::character varying,
    source_email character varying(255),
    source_name character varying(255),
    subject text,
    body_preview text,
    ai_classification character varying(50),
    ai_color character varying(10),
    ai_summary text,
    ai_recommendation text,
    ai_work_type character varying(100),
    ai_estimated_budget numeric(15,2),
    ai_estimated_days integer,
    ai_keywords text[],
    ai_confidence numeric(5,2),
    ai_raw_json jsonb,
    ai_analyzed_at timestamp without time zone,
    ai_model character varying(100),
    workload_snapshot jsonb,
    status character varying(30) DEFAULT 'new'::character varying,
    decision_by integer,
    decision_at timestamp without time zone,
    decision_notes text,
    rejection_reason text,
    linked_tender_id integer,
    linked_work_id integer,
    attachment_count integer DEFAULT 0,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    ai_report text,
    ai_cost_estimate numeric,
    ai_cost_report text,
    CONSTRAINT inbox_applications_ai_color_check CHECK (((ai_color)::text = ANY (ARRAY[('green'::character varying)::text, ('yellow'::character varying)::text, ('red'::character varying)::text]))),
    CONSTRAINT inbox_applications_status_check CHECK (((status)::text = ANY (ARRAY[('new'::character varying)::text, ('ai_processed'::character varying)::text, ('under_review'::character varying)::text, ('accepted'::character varying)::text, ('rejected'::character varying)::text, ('archived'::character varying)::text])))
);


--
-- Name: inbox_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_applications_id_seq OWNED BY public.inbox_applications.id;


--
-- Name: incomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incomes (
    id integer NOT NULL,
    work_id integer,
    type character varying(100),
    amount numeric(15,2) NOT NULL,
    date date,
    counterparty character varying(255),
    description text,
    document_number character varying(100),
    source character varying(50),
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    invoice_id integer,
    comment text,
    confirmed boolean DEFAULT true,
    import_hash text
);


--
-- Name: incomes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.incomes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incomes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.incomes_id_seq OWNED BY public.incomes.id;


--
-- Name: inventory_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_checks (
    id integer NOT NULL,
    warehouse_id integer,
    check_date date NOT NULL,
    status character varying(20) DEFAULT 'in_progress'::character varying,
    total_items integer DEFAULT 0,
    found_items integer DEFAULT 0,
    missing_items integer DEFAULT 0,
    surplus_items integer DEFAULT 0,
    notes text,
    conducted_by integer,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: inventory_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_checks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_checks_id_seq OWNED BY public.inventory_checks.id;


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payments (
    id integer NOT NULL,
    invoice_id integer,
    amount numeric(15,2),
    payment_date date,
    payment_method character varying(50),
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    created_by integer
);


--
-- Name: invoice_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_payments_id_seq OWNED BY public.invoice_payments.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    invoice_number character varying(50),
    invoice_date date,
    invoice_type character varying(20) DEFAULT 'incoming'::character varying,
    status character varying(20) DEFAULT 'pending'::character varying,
    work_id integer,
    act_id integer,
    customer_name character varying(255),
    customer_inn character varying(20),
    amount numeric(15,2),
    vat_pct integer DEFAULT 20,
    total_amount numeric(15,2),
    due_date date,
    paid_amount numeric(15,2) DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by integer,
    paid_date date,
    vat_amount numeric(15,2),
    file_path text,
    contract_id integer,
    comment text,
    description text,
    customer_id integer,
    items_json jsonb,
    exported_at timestamp without time zone,
    source character varying(50),
    tender_id integer,
    estimate_id integer,
    tkp_id integer
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: ivr_audio_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ivr_audio_cache (
    id integer NOT NULL,
    text_hash character varying(64) NOT NULL,
    text text NOT NULL,
    file_path text NOT NULL,
    voice character varying(50) DEFAULT 'alena'::character varying,
    format character varying(20) DEFAULT 'oggopus'::character varying,
    file_size integer,
    created_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone DEFAULT now()
);


--
-- Name: ivr_audio_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ivr_audio_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ivr_audio_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ivr_audio_cache_id_seq OWNED BY public.ivr_audio_cache.id;


--
-- Name: meeting_minutes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_minutes (
    id integer NOT NULL,
    meeting_id integer NOT NULL,
    item_order integer DEFAULT 0,
    item_type character varying(20) DEFAULT 'note'::character varying,
    content text NOT NULL,
    responsible_user_id integer,
    deadline timestamp without time zone,
    task_id integer,
    created_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: meeting_minutes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meeting_minutes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meeting_minutes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meeting_minutes_id_seq OWNED BY public.meeting_minutes.id;


--
-- Name: meeting_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_participants (
    id integer NOT NULL,
    meeting_id integer NOT NULL,
    user_id integer NOT NULL,
    rsvp_status character varying(20) DEFAULT 'pending'::character varying,
    rsvp_comment text,
    attended boolean,
    notified_at timestamp without time zone,
    reminder_sent_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: meeting_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meeting_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meeting_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meeting_participants_id_seq OWNED BY public.meeting_participants.id;


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id integer NOT NULL,
    organizer_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    location character varying(255),
    start_time timestamp without time zone NOT NULL,
    end_time timestamp without time zone,
    is_recurring boolean DEFAULT false,
    recurrence_rule text,
    status character varying(20) DEFAULT 'scheduled'::character varying,
    agenda text,
    minutes text,
    minutes_author_id integer,
    minutes_approved_at timestamp without time zone,
    work_id integer,
    tender_id integer,
    notify_before_minutes integer DEFAULT 15,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: meetings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meetings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meetings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meetings_id_seq OWNED BY public.meetings.id;


--
-- Name: migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    executed_at timestamp without time zone DEFAULT now()
);


--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: mimir_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mimir_conversations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(500) DEFAULT 'Новый диалог'::character varying,
    is_archived boolean DEFAULT false,
    is_pinned boolean DEFAULT false,
    message_count integer DEFAULT 0,
    total_tokens integer DEFAULT 0,
    last_message_at timestamp without time zone,
    last_message_preview text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mimir_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mimir_conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mimir_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mimir_conversations_id_seq OWNED BY public.mimir_conversations.id;


--
-- Name: mimir_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mimir_messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    content_type character varying(20) DEFAULT 'text'::character varying,
    tokens_input integer DEFAULT 0,
    tokens_output integer DEFAULT 0,
    model_used character varying(100),
    has_files boolean DEFAULT false,
    file_names text[],
    search_results jsonb,
    duration_ms integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mimir_messages_content_type_check CHECK (((content_type)::text = ANY (ARRAY[('text'::character varying)::text, ('file_analysis'::character varying)::text, ('tkp'::character varying)::text, ('error'::character varying)::text]))),
    CONSTRAINT mimir_messages_role_check CHECK (((role)::text = ANY (ARRAY[('user'::character varying)::text, ('assistant'::character varying)::text, ('system'::character varying)::text])))
);


--
-- Name: mimir_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mimir_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mimir_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mimir_messages_id_seq OWNED BY public.mimir_messages.id;


--
-- Name: mimir_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mimir_usage_log (
    id integer NOT NULL,
    user_id integer,
    conversation_id integer,
    provider character varying(20) DEFAULT 'unknown'::character varying,
    model character varying(100) DEFAULT 'unknown'::character varying,
    tokens_input integer DEFAULT 0,
    tokens_output integer DEFAULT 0,
    duration_ms integer DEFAULT 0,
    success boolean DEFAULT true,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mimir_usage_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mimir_usage_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mimir_usage_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mimir_usage_log_id_seq OWNED BY public.mimir_usage_log.id;


--
-- Name: modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modules (
    id integer NOT NULL,
    key character varying(50) NOT NULL,
    label character varying(100) NOT NULL,
    description text,
    category character varying(50) DEFAULT 'general'::character varying,
    icon character varying(50),
    sort_order integer DEFAULT 100,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: modules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.modules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: modules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.modules_id_seq OWNED BY public.modules.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer,
    type character varying(100),
    title character varying(500),
    message text,
    is_read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    entity_id integer,
    entity_type character varying(50),
    link text,
    updated_at timestamp without time zone DEFAULT now(),
    read_at timestamp without time zone,
    link_hash text,
    kind text,
    day_key text,
    dedup_key text,
    dismissed_at timestamp without time zone,
    created_by integer,
    url character varying(500),
    body text
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objects (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    code character varying(20),
    address text,
    city character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    customer_inn character varying(20),
    work_id integer,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: objects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.objects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: objects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.objects_id_seq OWNED BY public.objects.id;


--
-- Name: office_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.office_expenses (
    id integer NOT NULL,
    category character varying(100),
    amount numeric(15,2) NOT NULL,
    date date,
    description text,
    document_number character varying(100),
    counterparty character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    source character varying(50),
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    supplier character varying(255),
    doc_number character varying(100),
    comment text,
    vat_pct integer DEFAULT 20,
    vat_amount numeric(15,2),
    total_amount numeric(15,2),
    payment_date date,
    invoice_needed boolean DEFAULT false,
    invoice_received boolean DEFAULT false,
    number character varying(100),
    payment_method character varying(50),
    contract_id integer,
    submitted_at timestamp without time zone,
    work_id integer,
    import_hash text,
    notes text,
    receipt_url text
);


--
-- Name: office_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.office_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: office_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.office_expenses_id_seq OWNED BY public.office_expenses.id;


--
-- Name: one_time_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.one_time_payments (
    id integer NOT NULL,
    employee_id integer,
    employee_name text,
    work_id integer,
    amount numeric(15,2) NOT NULL,
    reason text NOT NULL,
    payment_method character varying(30) DEFAULT 'card'::character varying,
    payment_type character varying(30) DEFAULT 'one_time'::character varying,
    status character varying(30) DEFAULT 'pending'::character varying,
    requested_by integer,
    approved_by integer,
    approved_at timestamp without time zone,
    paid_at timestamp without time zone,
    comment text,
    director_comment text,
    receipt_url text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: one_time_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.one_time_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: one_time_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.one_time_payments_id_seq OWNED BY public.one_time_payments.id;


--
-- Name: pass_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pass_requests (
    id integer NOT NULL,
    tender_id integer,
    work_id integer,
    object_name text,
    object_address text,
    request_type text DEFAULT 'Пропуск'::text,
    workers jsonb DEFAULT '[]'::jsonb,
    vehicles jsonb DEFAULT '[]'::jsonb,
    date_from date,
    date_to date,
    status text DEFAULT 'draft'::text,
    pdf_path text,
    notes text,
    author_id integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    request_date date DEFAULT CURRENT_DATE,
    equipment_json jsonb DEFAULT '[]'::jsonb,
    contact_person text,
    contact_phone text,
    approved_at timestamp with time zone
);


--
-- Name: pass_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pass_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pass_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pass_requests_id_seq OWNED BY public.pass_requests.id;


--
-- Name: payment_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_registry (
    id integer NOT NULL,
    sheet_id integer,
    employee_id integer,
    employee_name text,
    amount numeric(15,2) NOT NULL,
    payment_type character varying(30) DEFAULT 'salary'::character varying,
    payment_method character varying(30) DEFAULT 'card'::character varying,
    inn character varying(20),
    bank_name text,
    bik character varying(20),
    account_number character varying(30),
    status character varying(30) DEFAULT 'pending'::character varying,
    paid_at timestamp without time zone,
    bank_ref text,
    payment_order_number text,
    comment text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: payment_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_registry_id_seq OWNED BY public.payment_registry.id;


--
-- Name: payroll_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_items (
    id integer NOT NULL,
    sheet_id integer,
    employee_id integer,
    employee_name text,
    work_id integer,
    role_on_work character varying(100),
    days_worked integer DEFAULT 0,
    day_rate numeric(12,2) DEFAULT 0,
    base_amount numeric(15,2) DEFAULT 0,
    bonus numeric(15,2) DEFAULT 0,
    overtime_hours numeric(8,2) DEFAULT 0,
    overtime_amount numeric(15,2) DEFAULT 0,
    penalty numeric(15,2) DEFAULT 0,
    penalty_reason text,
    advance_paid numeric(15,2) DEFAULT 0,
    deductions numeric(15,2) DEFAULT 0,
    deductions_reason text,
    accrued numeric(15,2) DEFAULT 0,
    payout numeric(15,2) DEFAULT 0,
    payment_method character varying(30) DEFAULT 'card'::character varying,
    is_self_employed boolean DEFAULT false,
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: payroll_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_items_id_seq OWNED BY public.payroll_items.id;


--
-- Name: payroll_sheets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_sheets (
    id integer NOT NULL,
    work_id integer,
    title text NOT NULL,
    period_from date NOT NULL,
    period_to date NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying,
    total_accrued numeric(15,2) DEFAULT 0,
    total_bonus numeric(15,2) DEFAULT 0,
    total_penalty numeric(15,2) DEFAULT 0,
    total_advance_paid numeric(15,2) DEFAULT 0,
    total_payout numeric(15,2) DEFAULT 0,
    workers_count integer DEFAULT 0,
    created_by integer,
    approved_by integer,
    approved_at timestamp without time zone,
    paid_by integer,
    paid_at timestamp without time zone,
    comment text,
    director_comment text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: payroll_sheets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_sheets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_sheets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_sheets_id_seq OWNED BY public.payroll_sheets.id;


--
-- Name: permit_application_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permit_application_history (
    id integer NOT NULL,
    application_id integer NOT NULL,
    old_status character varying(30),
    new_status character varying(30) NOT NULL,
    changed_by integer,
    comment text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: permit_application_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permit_application_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permit_application_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permit_application_history_id_seq OWNED BY public.permit_application_history.id;


--
-- Name: permit_application_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permit_application_items (
    id integer NOT NULL,
    application_id integer NOT NULL,
    employee_id integer NOT NULL,
    permit_type_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    notes text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: permit_application_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permit_application_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permit_application_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permit_application_items_id_seq OWNED BY public.permit_application_items.id;


--
-- Name: permit_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permit_applications (
    id integer NOT NULL,
    number character varying(50),
    title character varying(500),
    contractor_email character varying(255),
    contractor_name character varying(255),
    cover_letter text,
    status character varying(30) DEFAULT 'draft'::character varying,
    sent_at timestamp without time zone,
    sent_by integer,
    email_message_id character varying(255),
    excel_file_path text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    rejection_reason text,
    approved_by integer,
    is_urgent boolean DEFAULT false,
    CONSTRAINT permit_applications_status_check CHECK (((status)::text = ANY (ARRAY['draft'::text, 'sent'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'docs_requested'::text, 'accepted'::text, 'rejected'::text])))
);


--
-- Name: permit_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permit_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permit_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permit_applications_id_seq OWNED BY public.permit_applications.id;


--
-- Name: permit_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permit_types (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(30) NOT NULL,
    validity_months integer,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    code character varying(50),
    description text,
    is_system boolean DEFAULT false,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: permit_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permit_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permit_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permit_types_id_seq OWNED BY public.permit_types.id;


--
-- Name: platform_parse_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_parse_results (
    id integer NOT NULL,
    email_id integer,
    pre_tender_id integer,
    platform_name character varying(100),
    platform_code character varying(50),
    purchase_number character varying(100),
    purchase_url text,
    lot_number character varying(20),
    purchase_method character varying(100),
    customer_name character varying(500),
    customer_inn character varying(20),
    object_description text,
    nmck numeric(15,2),
    currency character varying(3) DEFAULT 'RUB'::character varying,
    application_deadline timestamp without time zone,
    auction_date timestamp without time zone,
    work_start_date date,
    work_end_date date,
    docs_downloaded boolean DEFAULT false,
    docs_download_error text,
    docs_paths jsonb DEFAULT '[]'::jsonb,
    ai_relevance_score integer,
    ai_analysis text,
    ai_keywords jsonb DEFAULT '[]'::jsonb,
    parse_status character varying(30) DEFAULT 'pending'::character varying,
    parse_error text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT platform_parse_results_ai_relevance_score_check CHECK (((ai_relevance_score IS NULL) OR ((ai_relevance_score >= 0) AND (ai_relevance_score <= 100)))),
    CONSTRAINT platform_parse_results_parse_status_check CHECK (((parse_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('parsing'::character varying)::text, ('parsed'::character varying)::text, ('docs_downloading'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('manual'::character varying)::text])))
);


--
-- Name: platform_parse_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_parse_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_parse_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_parse_results_id_seq OWNED BY public.platform_parse_results.id;


--
-- Name: pm_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_consents (
    id integer NOT NULL,
    pm_id integer,
    type character varying(50),
    status character varying(50) DEFAULT 'pending'::character varying,
    entity_type character varying(50),
    entity_id integer,
    comments text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: pm_consents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pm_consents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pm_consents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pm_consents_id_seq OWNED BY public.pm_consents.id;


--
-- Name: pre_tender_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_tender_requests (
    id integer NOT NULL,
    email_id integer,
    source_type character varying(30) DEFAULT 'email'::character varying NOT NULL,
    customer_name character varying(500),
    customer_inn character varying(20),
    customer_email character varying(255),
    contact_person character varying(255),
    contact_phone character varying(100),
    work_description text,
    work_location character varying(500),
    work_deadline date,
    estimated_sum numeric(14,2),
    ai_summary text,
    ai_color character varying(20) DEFAULT 'yellow'::character varying,
    ai_recommendation text,
    ai_work_match_score integer DEFAULT 50,
    ai_workload_warning text,
    ai_processed_at timestamp without time zone,
    has_documents boolean DEFAULT false,
    documents_summary text,
    manual_documents jsonb DEFAULT '[]'::jsonb,
    status character varying(30) DEFAULT 'new'::character varying NOT NULL,
    decision_by integer,
    decision_at timestamp without time zone,
    decision_comment text,
    reject_reason text,
    created_tender_id integer,
    response_email_id integer,
    assigned_to integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    approval_requested_by integer,
    approval_requested_at timestamp without time zone,
    approval_comment text,
    CONSTRAINT pre_tender_requests_ai_color_check CHECK (((ai_color)::text = ANY (ARRAY[('green'::character varying)::text, ('yellow'::character varying)::text, ('red'::character varying)::text, ('gray'::character varying)::text]))),
    CONSTRAINT pre_tender_requests_ai_work_match_score_check CHECK (((ai_work_match_score >= 0) AND (ai_work_match_score <= 100))),
    CONSTRAINT pre_tender_requests_source_type_check CHECK (((source_type)::text = ANY (ARRAY[('email'::character varying)::text, ('manual'::character varying)::text, ('platform'::character varying)::text]))),
    CONSTRAINT pre_tender_requests_status_check CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'in_review'::character varying, 'need_docs'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'expired'::character varying, 'pending_approval'::character varying])::text[])))
);


--
-- Name: COLUMN pre_tender_requests.approval_requested_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pre_tender_requests.approval_requested_by IS 'User who requested director approval (TO/HEAD_TO)';


--
-- Name: pre_tender_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pre_tender_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pre_tender_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pre_tender_requests_id_seq OWNED BY public.pre_tender_requests.id;


--
-- Name: proxies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proxies (
    id integer NOT NULL,
    type character varying(100),
    number character varying(100),
    issue_date date,
    valid_until date,
    employee_id integer,
    employee_name character varying(255),
    fio character varying(255),
    passport text,
    powers_general text,
    description text,
    address text,
    supplier character varying(255),
    goods_list text,
    vehicle_brand character varying(100),
    vehicle_number character varying(50),
    vin character varying(50),
    bank_name character varying(255),
    account_number character varying(50),
    tax_office character varying(255),
    court_name character varying(255),
    case_number character varying(100),
    license character varying(100),
    status character varying(50) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: proxies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proxies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proxies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proxies_id_seq OWNED BY public.proxies.id;


--
-- Name: purchase_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_requests (
    id integer NOT NULL,
    work_id integer,
    pm_id integer,
    status character varying(50) DEFAULT 'new'::character varying,
    items_json text,
    total_amount numeric(15,2),
    urgency character varying(20),
    comments text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    decided_at timestamp without time zone,
    decided_by_user_id integer
);


--
-- Name: purchase_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_requests_id_seq OWNED BY public.purchase_requests.id;


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    device_info character varying(255),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- Name: qa_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_messages (
    id integer NOT NULL,
    tender_id integer,
    estimate_id integer,
    pm_id integer,
    question text,
    answer text,
    is_open boolean DEFAULT true,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: qa_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_messages_id_seq OWNED BY public.qa_messages.id;


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminders (
    id integer NOT NULL,
    user_id integer,
    title character varying(255),
    description text,
    due_date timestamp without time zone,
    status character varying(20) DEFAULT 'active'::character varying,
    priority character varying(20) DEFAULT 'normal'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    entity_id integer,
    entity_type character varying(50),
    completed_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now(),
    due_time time without time zone,
    message text,
    auto_key character varying(100),
    next_at timestamp without time zone,
    sent_at timestamp without time zone,
    completed boolean DEFAULT false,
    dismissed boolean DEFAULT false,
    dismissed_at timestamp without time zone,
    type character varying(50) DEFAULT 'custom'::character varying,
    reminder_date timestamp with time zone
);


--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reminders_id_seq OWNED BY public.reminders.id;


--
-- Name: role_analytics_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_analytics_cache (
    id integer NOT NULL,
    role character varying(50) NOT NULL,
    user_id integer,
    metric_key character varying(100) NOT NULL,
    metric_value numeric(15,2) DEFAULT 0,
    period character varying(20),
    calculated_at timestamp without time zone DEFAULT now()
);


--
-- Name: role_analytics_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_analytics_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_analytics_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_analytics_cache_id_seq OWNED BY public.role_analytics_cache.id;


--
-- Name: role_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_presets (
    id integer NOT NULL,
    role character varying(50) NOT NULL,
    module_key character varying(50) NOT NULL,
    can_read boolean DEFAULT false,
    can_write boolean DEFAULT false,
    can_delete boolean DEFAULT false
);


--
-- Name: role_presets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_presets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_presets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_presets_id_seq OWNED BY public.role_presets.id;


--
-- Name: saved_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_reports (
    id integer NOT NULL,
    type character varying(100),
    period character varying(50),
    period_code character varying(50),
    data jsonb,
    user_id integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: saved_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.saved_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: saved_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.saved_reports_id_seq OWNED BY public.saved_reports.id;


--
-- Name: seal_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seal_transfers (
    id integer NOT NULL,
    seal_id integer,
    from_id integer,
    to_id integer,
    status character varying(50) DEFAULT 'pending'::character varying,
    transfer_date timestamp without time zone,
    return_date timestamp without time zone,
    comments text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    from_holder_id integer,
    to_holder_id integer,
    from_holder_name character varying(255),
    to_holder_name character varying(255),
    reason text,
    created_by integer,
    is_indefinite boolean DEFAULT false,
    purpose text,
    confirmed_at timestamp without time zone,
    approved_by integer,
    approved_at timestamp without time zone,
    comment text
);


--
-- Name: seal_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seal_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seal_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.seal_transfers_id_seq OWNED BY public.seal_transfers.id;


--
-- Name: seals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seals (
    id integer NOT NULL,
    type character varying(50),
    name character varying(200),
    description text,
    status character varying(50) DEFAULT 'available'::character varying,
    holder_id integer,
    location character varying(200),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    inv_number character varying(100),
    purchase_date date,
    serial_number character varying(100),
    issue_date date,
    expiry_date date,
    notes text,
    comment text,
    return_date date,
    transfer_date date,
    holder_name character varying(255),
    prev_holder_id integer,
    prev_holder_name character varying(255),
    transfer_reason text,
    responsible_id integer,
    organization character varying(255),
    registration_number character varying(100),
    is_indefinite boolean DEFAULT false,
    purpose text,
    pending_transfer_id integer
);


--
-- Name: seals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.seals_id_seq OWNED BY public.seals.id;


--
-- Name: self_employed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.self_employed (
    id integer NOT NULL,
    employee_id integer,
    full_name text NOT NULL,
    inn character varying(12) NOT NULL,
    phone character varying(50),
    email character varying(255),
    bank_name text,
    bik character varying(20),
    corr_account character varying(30),
    account_number character varying(30),
    card_number character varying(20),
    npd_status character varying(30) DEFAULT 'active'::character varying,
    npd_registered_at date,
    contract_number text,
    contract_date date,
    contract_end_date date,
    comment text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: self_employed_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.self_employed_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: self_employed_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.self_employed_id_seq OWNED BY public.self_employed.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key character varying(100) NOT NULL,
    value_json text,
    updated_at timestamp without time zone DEFAULT now(),
    id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: site_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_inspections (
    id integer NOT NULL,
    work_id integer,
    estimate_id integer,
    tender_id integer,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    object_name character varying(500),
    object_address text,
    customer_name character varying(500),
    customer_contact_person character varying(255),
    customer_contact_email character varying(255),
    customer_contact_phone character varying(100),
    inspection_dates jsonb DEFAULT '[]'::jsonb,
    employees_json jsonb DEFAULT '[]'::jsonb,
    vehicles_json jsonb DEFAULT '[]'::jsonb,
    notes text,
    author_id integer,
    approved_by integer,
    approved_at timestamp without time zone,
    rejected_at timestamp without time zone,
    rejected_reason text,
    sent_at timestamp without time zone,
    email_sent_to character varying(255),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: site_inspections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.site_inspections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: site_inspections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.site_inspections_id_seq OWNED BY public.site_inspections.id;


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id integer NOT NULL,
    name character varying(500) NOT NULL,
    short_name character varying(200),
    lat double precision,
    lng double precision,
    region character varying(200),
    site_type character varying(50) DEFAULT 'object'::character varying,
    customer_id integer,
    customer_name character varying(500),
    address text,
    description text,
    geocode_status character varying(20) DEFAULT 'pending'::character varying,
    geocode_source character varying(200),
    photo_url character varying(500),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    status character varying(30) DEFAULT 'active'::character varying
);


--
-- Name: sites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sites_id_seq OWNED BY public.sites.id;


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id integer NOT NULL,
    name character varying(200),
    role_tag character varying(50),
    user_id integer,
    phone character varying(50),
    email character varying(200),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    "position" character varying(255),
    department character varying(100),
    city character varying(255),
    comment text
);


--
-- Name: staff_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_id_seq OWNED BY public.staff.id;


--
-- Name: staff_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_plan (
    id integer NOT NULL,
    staff_id integer,
    date date,
    work_id integer,
    status character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    status_code character varying(50),
    note text,
    comment text,
    kind character varying(50),
    employee_id integer,
    staff_request_id integer,
    fio character varying(255)
);


--
-- Name: staff_plan_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_plan_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_plan_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_plan_id_seq OWNED BY public.staff_plan.id;


--
-- Name: staff_replacements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_replacements (
    id integer NOT NULL,
    staff_request_id integer,
    work_id integer,
    old_employee_id integer,
    new_employee_id integer,
    status character varying(50) DEFAULT 'pending'::character varying,
    reason text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: staff_replacements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_replacements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_replacements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_replacements_id_seq OWNED BY public.staff_replacements.id;


--
-- Name: staff_request_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_request_messages (
    id integer NOT NULL,
    staff_request_id integer,
    author_user_id integer,
    message text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: staff_request_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_request_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_request_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_request_messages_id_seq OWNED BY public.staff_request_messages.id;


--
-- Name: staff_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_requests (
    id integer NOT NULL,
    work_id integer,
    pm_id integer,
    status character varying(50) DEFAULT 'new'::character varying,
    required_count integer,
    specialization text,
    date_from date,
    date_to date,
    comments text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    proposed_staff_ids_json jsonb,
    approved_staff_ids_json jsonb,
    is_vachta boolean DEFAULT false,
    rotation_days integer,
    request_json jsonb,
    pm_comment text,
    hr_comment text,
    crew character varying(1)
);


--
-- Name: staff_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_requests_id_seq OWNED BY public.staff_requests.id;


--
-- Name: sync_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_meta (
    table_name character varying(100) NOT NULL,
    last_sync timestamp without time zone,
    status character varying(50),
    error_message text
);


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    id integer NOT NULL,
    task_id integer NOT NULL,
    user_id integer NOT NULL,
    text text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    is_system boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: task_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_comments_id_seq OWNED BY public.task_comments.id;


--
-- Name: task_watchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_watchers (
    id integer NOT NULL,
    task_id integer NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: task_watchers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_watchers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_watchers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_watchers_id_seq OWNED BY public.task_watchers.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    creator_id integer NOT NULL,
    assignee_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    deadline timestamp without time zone,
    priority character varying(20) DEFAULT 'normal'::character varying,
    status character varying(20) DEFAULT 'new'::character varying NOT NULL,
    accepted_at timestamp without time zone,
    completed_at timestamp without time zone,
    files jsonb DEFAULT '[]'::jsonb,
    creator_comment text,
    assignee_comment text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    kanban_column character varying(20) DEFAULT 'new'::character varying,
    kanban_position integer DEFAULT 0,
    acknowledged_at timestamp without time zone,
    acknowledged_by integer,
    work_id integer,
    tender_id integer,
    parent_task_id integer,
    estimated_hours numeric(6,2),
    actual_hours numeric(6,2),
    tags jsonb DEFAULT '[]'::jsonb,
    archived_at timestamp without time zone,
    archived_by integer
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: telephony_escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telephony_escalations (
    id integer NOT NULL,
    call_id integer,
    user_id integer,
    deadline_at timestamp with time zone NOT NULL,
    escalated boolean DEFAULT false,
    escalated_at timestamp with time zone,
    acknowledged boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: telephony_escalations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telephony_escalations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telephony_escalations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telephony_escalations_id_seq OWNED BY public.telephony_escalations.id;


--
-- Name: telephony_events_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telephony_events_log (
    id integer NOT NULL,
    event_type character varying(50) NOT NULL,
    mango_call_id character varying(200),
    mango_entry_id character varying(200),
    payload jsonb NOT NULL,
    processed boolean DEFAULT false,
    processing_result jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: telephony_events_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telephony_events_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telephony_events_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telephony_events_log_id_seq OWNED BY public.telephony_events_log.id;


--
-- Name: telephony_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telephony_jobs (
    id integer NOT NULL,
    job_type character varying(50) NOT NULL,
    call_id integer,
    payload jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    error text,
    scheduled_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: telephony_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telephony_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telephony_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telephony_jobs_id_seq OWNED BY public.telephony_jobs.id;


--
-- Name: tenders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenders (
    id integer NOT NULL,
    customer character varying(500),
    customer_inn character varying(20),
    tender_number character varying(255),
    tender_type character varying(100),
    tender_status character varying(100) DEFAULT 'Новый'::character varying,
    period character varying(20),
    year integer,
    deadline date,
    estimated_sum numeric(15,2),
    responsible_pm_id integer,
    tag character varying(255),
    docs_link text,
    comment_to text,
    comment_dir text,
    reject_reason text,
    dedup_key text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    tender_title text,
    customer_name character varying(500),
    tender_price numeric(15,2),
    docs_deadline date,
    pm_id integer,
    source character varying(100),
    platform character varying(255),
    link text,
    status character varying(50),
    assigned_at timestamp without time zone,
    assigned_by_user_id integer,
    created_by_user_id integer,
    cost_plan numeric(15,2),
    work_start_plan date,
    work_end_plan date,
    inn character varying(20),
    purchase_url text,
    group_tag text,
    tender_comment_to text,
    tender_description text,
    tender_region text,
    tender_contact text,
    tender_phone text,
    tender_email text,
    handoff_at timestamp without time zone,
    handoff_by_user_id integer,
    distribution_requested_at timestamp without time zone,
    distribution_requested_by_user_id integer,
    require_docs_on_handoff boolean DEFAULT false,
    distribution_assigned_at timestamp without time zone,
    distribution_assigned_by_user_id integer,
    tkp_sent_at timestamp without time zone,
    tkp_followup_next_at timestamp without time zone,
    tkp_followup_closed_at timestamp without time zone,
    pm_login character varying(100),
    saved_at timestamp without time zone,
    site_id integer,
    ai_report text,
    ai_cost_estimate numeric,
    ai_cost_report text
);


--
-- Name: tenders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenders_id_seq OWNED BY public.tenders.id;


--
-- Name: tkp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tkp (
    id integer NOT NULL,
    tender_id integer,
    number text,
    customer_name text,
    customer_inn text,
    contact_person text,
    contact_email text,
    contact_phone text,
    subject text,
    items jsonb DEFAULT '[]'::jsonb,
    total_sum numeric(15,2) DEFAULT 0,
    discount_percent numeric(5,2) DEFAULT 0,
    final_sum numeric(15,2) DEFAULT 0,
    valid_until date,
    status text DEFAULT 'draft'::text,
    sent_at timestamp with time zone,
    sent_via text,
    pdf_path text,
    notes text,
    author_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    work_id integer,
    services text,
    deadline text,
    validity_days integer DEFAULT 30,
    sent_by integer,
    tkp_number character varying(50),
    source character varying(50) DEFAULT 'registry'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    customer_address text,
    work_description text,
    estimate_id integer
);


--
-- Name: tkp_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tkp_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tkp_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tkp_id_seq OWNED BY public.tkp.id;


--
-- Name: tmc_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tmc_requests (
    id integer NOT NULL,
    work_id integer,
    tender_id integer,
    request_type text DEFAULT 'import'::text,
    items jsonb DEFAULT '[]'::jsonb,
    total_sum numeric(15,2) DEFAULT 0,
    status text DEFAULT 'draft'::text,
    supplier text,
    delivery_date date,
    notes text,
    author_id integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    title text,
    priority text DEFAULT 'normal'::text,
    needed_by date,
    delivery_address text,
    approved_at timestamp with time zone
);


--
-- Name: tmc_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tmc_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tmc_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tmc_requests_id_seq OWNED BY public.tmc_requests.id;


--
-- Name: todo_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todo_items (
    id integer NOT NULL,
    user_id integer NOT NULL,
    text character varying(500) NOT NULL,
    done boolean DEFAULT false,
    done_at timestamp without time zone,
    auto_delete_hours integer DEFAULT 48,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: todo_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.todo_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: todo_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.todo_items_id_seq OWNED BY public.todo_items.id;


--
-- Name: training_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_applications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    course_name character varying(500) NOT NULL,
    provider character varying(300),
    training_type character varying(100) DEFAULT 'external'::character varying,
    date_start date,
    date_end date,
    cost numeric(12,2) DEFAULT 0,
    justification text,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    comment text,
    approved_by_head integer,
    approved_by_head_at timestamp with time zone,
    approved_by_dir integer,
    approved_by_dir_at timestamp with time zone,
    paid_by_buh integer,
    paid_by_buh_at timestamp with time zone,
    completed_by_hr integer,
    completed_by_hr_at timestamp with time zone,
    rejected_by integer,
    rejected_at timestamp with time zone,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_applications_id_seq OWNED BY public.training_applications.id;


--
-- Name: travel_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.travel_expenses (
    id integer NOT NULL,
    expense_type character varying(50),
    work_id integer,
    employee_id integer,
    date date,
    amount numeric(15,2),
    description text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    supplier character varying(255),
    counterparty character varying(255),
    document_number character varying(100),
    status character varying(50),
    approved_by integer,
    approved_at timestamp without time zone,
    comment text,
    date_from date,
    date_to date,
    doc_number character varying(100),
    currency character varying(10) DEFAULT 'RUB'::character varying
);


--
-- Name: travel_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.travel_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: travel_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.travel_expenses_id_seq OWNED BY public.travel_expenses.id;


--
-- Name: user_call_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_call_status (
    user_id integer NOT NULL,
    accepting boolean DEFAULT true,
    status character varying(50),
    updated_at timestamp without time zone DEFAULT now(),
    id integer NOT NULL,
    busy boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    mango_extension character varying(20),
    fallback_user_id integer,
    fallback_mobile character varying(50),
    work_schedule jsonb DEFAULT '{"fri": {"end": "18:00", "start": "09:00"}, "mon": {"end": "18:00", "start": "09:00"}, "thu": {"end": "18:00", "start": "09:00"}, "tue": {"end": "18:00", "start": "09:00"}, "wed": {"end": "18:00", "start": "09:00"}}'::jsonb,
    is_duty boolean DEFAULT false,
    display_name character varying(200),
    sip_login character varying(100),
    last_call_at timestamp with time zone,
    receive_call_push boolean DEFAULT false,
    is_call_dispatcher boolean DEFAULT false
);


--
-- Name: user_call_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_call_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_call_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_call_status_id_seq OWNED BY public.user_call_status.id;


--
-- Name: user_dashboard; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_dashboard (
    user_id integer NOT NULL,
    widgets_json text,
    layout_json text,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_email_accounts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    email_address character varying(255) NOT NULL,
    imap_host character varying(255) DEFAULT 'imap.yandex.ru'::character varying,
    imap_port integer DEFAULT 993,
    imap_user character varying(255),
    imap_pass_encrypted text,
    imap_tls boolean DEFAULT true,
    smtp_host character varying(255) DEFAULT 'smtp.yandex.ru'::character varying,
    smtp_port integer DEFAULT 465,
    smtp_user character varying(255),
    smtp_pass_encrypted text,
    smtp_tls boolean DEFAULT true,
    display_name character varying(255),
    signature_html text,
    is_active boolean DEFAULT true,
    last_sync_at timestamp without time zone,
    last_sync_uid integer DEFAULT 0,
    last_sync_error text,
    sync_interval_sec integer DEFAULT 120,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_email_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_email_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_email_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_email_accounts_id_seq OWNED BY public.user_email_accounts.id;


--
-- Name: user_menu_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_menu_settings (
    user_id integer NOT NULL,
    hidden_routes jsonb DEFAULT '[]'::jsonb,
    route_order jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    module_key character varying(50) NOT NULL,
    can_read boolean DEFAULT false,
    can_write boolean DEFAULT false,
    can_delete boolean DEFAULT false,
    granted_by integer,
    granted_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_permissions_id_seq OWNED BY public.user_permissions.id;


--
-- Name: user_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_requests (
    id integer NOT NULL,
    user_id integer,
    status character varying(50) DEFAULT 'pending'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    comment text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_requests_id_seq OWNED BY public.user_requests.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    login character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    role character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    roles text[],
    is_active boolean DEFAULT false,
    telegram_chat_id character varying(50),
    temp_password_hash character varying(255),
    temp_password_expires timestamp without time zone,
    last_login_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    must_change_password boolean DEFAULT false,
    pin_hash character varying(255),
    phone character varying(50),
    birth_date date,
    employment_date date,
    is_blocked boolean DEFAULT false,
    blocked_at timestamp without time zone,
    blocked_by integer,
    block_reason text,
    password_changed_at timestamp without time zone,
    created_by integer,
    show_in_schedule boolean DEFAULT true,
    military_id text,
    ready boolean DEFAULT true,
    is_approved boolean DEFAULT true,
    patronymic character varying(255)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(20),
    address text,
    responsible_id integer,
    is_main boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    phone character varying(50),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: warehouses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warehouses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.warehouses_id_seq OWNED BY public.warehouses.id;


--
-- Name: webauthn_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webauthn_challenges (
    id integer NOT NULL,
    user_id integer NOT NULL,
    challenge text NOT NULL,
    type character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: webauthn_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webauthn_challenges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webauthn_challenges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webauthn_challenges_id_seq OWNED BY public.webauthn_challenges.id;


--
-- Name: webauthn_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    credential_id text NOT NULL,
    public_key bytea NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    device_name character varying(255) DEFAULT 'Устройство'::character varying,
    transports text[],
    created_at timestamp without time zone DEFAULT now(),
    last_used_at timestamp without time zone
);


--
-- Name: work_assign_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_assign_requests (
    id integer NOT NULL,
    tender_id integer,
    assigned_pm_id integer,
    status character varying(50) DEFAULT 'pending'::character varying,
    requested_at timestamp without time zone DEFAULT now(),
    processed_at timestamp without time zone,
    comments text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: work_assign_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_assign_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_assign_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_assign_requests_id_seq OWNED BY public.work_assign_requests.id;


--
-- Name: work_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_expenses (
    id integer NOT NULL,
    work_id integer,
    category character varying(100),
    amount numeric(15,2) NOT NULL,
    date date,
    description text,
    document_number character varying(255),
    counterparty character varying(500),
    source character varying(50),
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    supplier character varying(255),
    status character varying(255),
    approved_by integer,
    comment text,
    employee_id integer,
    bonus_request_id integer,
    fot_employee_id integer,
    fot_employee_name character varying(255),
    requires_approval boolean DEFAULT false,
    approval_status character varying(50),
    import_hash text,
    notes text,
    receipt_url text
);


--
-- Name: work_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_expenses_id_seq OWNED BY public.work_expenses.id;


--
-- Name: work_permit_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_permit_requirements (
    id integer NOT NULL,
    work_id integer NOT NULL,
    permit_type_id integer NOT NULL,
    is_mandatory boolean DEFAULT true,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: work_permit_requirements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_permit_requirements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_permit_requirements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_permit_requirements_id_seq OWNED BY public.work_permit_requirements.id;


--
-- Name: works; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.works (
    id integer NOT NULL,
    tender_id integer,
    estimate_id integer,
    pm_id integer,
    work_number character varying(100),
    work_status character varying(100) DEFAULT 'Новая'::character varying,
    contract_sum numeric(15,2),
    cost_plan numeric(15,2),
    cost_fact numeric(15,2),
    advance_percent numeric(5,2),
    advance_sum numeric(15,2),
    advance_received numeric(15,2),
    advance_date_plan date,
    advance_date_fact date,
    balance_sum numeric(15,2),
    balance_received numeric(15,2),
    payment_date_plan date,
    payment_date_fact date,
    start_date_plan date,
    start_in_work_date date,
    end_date_plan date,
    end_date_fact date,
    city character varying(255),
    address text,
    comment text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    work_start_plan date,
    work_end_plan date,
    work_title text,
    customer_name character varying(500),
    customer_inn character varying(20),
    object_name character varying(500),
    responsible_pm_id integer,
    contact_person character varying(255),
    contact_phone character varying(50),
    status character varying(50),
    vat_pct integer DEFAULT 20,
    end_fact date,
    contract_value numeric(15,2),
    staff_ids_json jsonb,
    rotation_days integer,
    is_vachta boolean DEFAULT false,
    hr_comment text,
    customer_score integer,
    payload_json jsonb,
    staff_request_id integer,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    closed_at timestamp without time zone,
    closeout_submitted_at timestamp without time zone,
    proposed_staff_ids_a_json jsonb,
    proposed_staff_ids_b_json jsonb,
    approved_staff_ids_a_json jsonb,
    approved_staff_ids_b_json jsonb,
    rework_requested_at timestamp without time zone,
    advance_pct numeric(5,2),
    w_adv_pct numeric(5,2),
    work_name text,
    start_plan date,
    act_signed_date_fact date,
    closeout_submitted_by integer,
    site_id integer,
    start_fact date,
    object_address text,
    description text,
    notes text,
    priority character varying(30),
    end_plan date
);


--
-- Name: works_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.works_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: works_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.works_id_seq OWNED BY public.works.id;


--
-- Name: active_calls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_calls ALTER COLUMN id SET DEFAULT nextval('public.active_calls_id_seq'::regclass);


--
-- Name: acts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acts ALTER COLUMN id SET DEFAULT nextval('public.acts_id_seq'::regclass);


--
-- Name: ai_analysis_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_log ALTER COLUMN id SET DEFAULT nextval('public.ai_analysis_log_id_seq'::regclass);


--
-- Name: approval_payment_slips id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_payment_slips ALTER COLUMN id SET DEFAULT nextval('public.approval_payment_slips_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: bank_classification_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_classification_rules ALTER COLUMN id SET DEFAULT nextval('public.bank_classification_rules_id_seq'::regclass);


--
-- Name: bank_import_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_batches ALTER COLUMN id SET DEFAULT nextval('public.bank_import_batches_id_seq'::regclass);


--
-- Name: bank_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_rules ALTER COLUMN id SET DEFAULT nextval('public.bank_rules_id_seq'::regclass);


--
-- Name: bank_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions ALTER COLUMN id SET DEFAULT nextval('public.bank_transactions_id_seq'::regclass);


--
-- Name: bonus_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_requests ALTER COLUMN id SET DEFAULT nextval('public.bonus_requests_id_seq'::regclass);


--
-- Name: business_trips id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_trips ALTER COLUMN id SET DEFAULT nextval('public.business_trips_id_seq'::regclass);


--
-- Name: calendar_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events ALTER COLUMN id SET DEFAULT nextval('public.calendar_events_id_seq'::regclass);


--
-- Name: call_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_history ALTER COLUMN id SET DEFAULT nextval('public.call_history_id_seq'::regclass);


--
-- Name: call_routing_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_routing_rules ALTER COLUMN id SET DEFAULT nextval('public.call_routing_rules_id_seq'::regclass);


--
-- Name: cash_balance_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_balance_log ALTER COLUMN id SET DEFAULT nextval('public.cash_balance_log_id_seq'::regclass);


--
-- Name: cash_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_expenses ALTER COLUMN id SET DEFAULT nextval('public.cash_expenses_id_seq'::regclass);


--
-- Name: cash_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_messages ALTER COLUMN id SET DEFAULT nextval('public.cash_messages_id_seq'::regclass);


--
-- Name: cash_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_requests ALTER COLUMN id SET DEFAULT nextval('public.cash_requests_id_seq'::regclass);


--
-- Name: cash_returns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_returns ALTER COLUMN id SET DEFAULT nextval('public.cash_returns_id_seq'::regclass);


--
-- Name: chat_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments ALTER COLUMN id SET DEFAULT nextval('public.chat_attachments_id_seq'::regclass);


--
-- Name: chat_group_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_group_members ALTER COLUMN id SET DEFAULT nextval('public.chat_group_members_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats ALTER COLUMN id SET DEFAULT nextval('public.chats_id_seq'::regclass);


--
-- Name: contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts ALTER COLUMN id SET DEFAULT nextval('public.contracts_id_seq'::regclass);


--
-- Name: correspondence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence ALTER COLUMN id SET DEFAULT nextval('public.correspondence_id_seq'::regclass);


--
-- Name: customer_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reviews ALTER COLUMN id SET DEFAULT nextval('public.customer_reviews_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: doc_sets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_sets ALTER COLUMN id SET DEFAULT nextval('public.doc_sets_id_seq'::regclass);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: email_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts ALTER COLUMN id SET DEFAULT nextval('public.email_accounts_id_seq'::regclass);


--
-- Name: email_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments ALTER COLUMN id SET DEFAULT nextval('public.email_attachments_id_seq'::regclass);


--
-- Name: email_classification_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_classification_rules ALTER COLUMN id SET DEFAULT nextval('public.email_classification_rules_id_seq'::regclass);


--
-- Name: email_folders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_folders ALTER COLUMN id SET DEFAULT nextval('public.email_folders_id_seq'::regclass);


--
-- Name: email_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_history ALTER COLUMN id SET DEFAULT nextval('public.email_history_id_seq'::regclass);


--
-- Name: email_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log ALTER COLUMN id SET DEFAULT nextval('public.email_log_id_seq'::regclass);


--
-- Name: email_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue ALTER COLUMN id SET DEFAULT nextval('public.email_queue_id_seq'::regclass);


--
-- Name: email_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sync_log ALTER COLUMN id SET DEFAULT nextval('public.email_sync_log_id_seq'::regclass);


--
-- Name: email_templates_v2 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates_v2 ALTER COLUMN id SET DEFAULT nextval('public.email_templates_v2_id_seq'::regclass);


--
-- Name: emails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails ALTER COLUMN id SET DEFAULT nextval('public.emails_id_seq'::regclass);


--
-- Name: employee_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_assignments ALTER COLUMN id SET DEFAULT nextval('public.employee_assignments_id_seq'::regclass);


--
-- Name: employee_collection_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collection_items ALTER COLUMN id SET DEFAULT nextval('public.employee_collection_items_id_seq'::regclass);


--
-- Name: employee_collections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collections ALTER COLUMN id SET DEFAULT nextval('public.employee_collections_id_seq'::regclass);


--
-- Name: employee_permits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permits ALTER COLUMN id SET DEFAULT nextval('public.employee_permits_id_seq'::regclass);


--
-- Name: employee_plan id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_plan ALTER COLUMN id SET DEFAULT nextval('public.employee_plan_id_seq'::regclass);


--
-- Name: employee_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rates ALTER COLUMN id SET DEFAULT nextval('public.employee_rates_id_seq'::regclass);


--
-- Name: employee_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reviews ALTER COLUMN id SET DEFAULT nextval('public.employee_reviews_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: equipment id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment ALTER COLUMN id SET DEFAULT nextval('public.equipment_id_seq'::regclass);


--
-- Name: equipment_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_categories ALTER COLUMN id SET DEFAULT nextval('public.equipment_categories_id_seq'::regclass);


--
-- Name: equipment_kit_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kit_items ALTER COLUMN id SET DEFAULT nextval('public.equipment_kit_items_id_seq'::regclass);


--
-- Name: equipment_kits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kits ALTER COLUMN id SET DEFAULT nextval('public.equipment_kits_id_seq'::regclass);


--
-- Name: equipment_maintenance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance ALTER COLUMN id SET DEFAULT nextval('public.equipment_maintenance_id_seq'::regclass);


--
-- Name: equipment_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements ALTER COLUMN id SET DEFAULT nextval('public.equipment_movements_id_seq'::regclass);


--
-- Name: equipment_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_requests ALTER COLUMN id SET DEFAULT nextval('public.equipment_requests_id_seq'::regclass);


--
-- Name: equipment_reservations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations ALTER COLUMN id SET DEFAULT nextval('public.equipment_reservations_id_seq'::regclass);


--
-- Name: equipment_work_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_work_assignments ALTER COLUMN id SET DEFAULT nextval('public.equipment_work_assignments_id_seq'::regclass);


--
-- Name: erp_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_connections ALTER COLUMN id SET DEFAULT nextval('public.erp_connections_id_seq'::regclass);


--
-- Name: erp_field_mappings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_field_mappings ALTER COLUMN id SET DEFAULT nextval('public.erp_field_mappings_id_seq'::regclass);


--
-- Name: erp_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_sync_log ALTER COLUMN id SET DEFAULT nextval('public.erp_sync_log_id_seq'::regclass);


--
-- Name: estimate_approval_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_events ALTER COLUMN id SET DEFAULT nextval('public.estimate_approval_events_id_seq'::regclass);


--
-- Name: estimate_approval_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests ALTER COLUMN id SET DEFAULT nextval('public.estimate_approval_requests_id_seq'::regclass);


--
-- Name: estimates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates ALTER COLUMN id SET DEFAULT nextval('public.estimates_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: hr_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_requests ALTER COLUMN id SET DEFAULT nextval('public.hr_requests_id_seq'::regclass);


--
-- Name: inbox_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_applications ALTER COLUMN id SET DEFAULT nextval('public.inbox_applications_id_seq'::regclass);


--
-- Name: incomes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incomes ALTER COLUMN id SET DEFAULT nextval('public.incomes_id_seq'::regclass);


--
-- Name: inventory_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_checks ALTER COLUMN id SET DEFAULT nextval('public.inventory_checks_id_seq'::regclass);


--
-- Name: invoice_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments ALTER COLUMN id SET DEFAULT nextval('public.invoice_payments_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: ivr_audio_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ivr_audio_cache ALTER COLUMN id SET DEFAULT nextval('public.ivr_audio_cache_id_seq'::regclass);


--
-- Name: meeting_minutes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes ALTER COLUMN id SET DEFAULT nextval('public.meeting_minutes_id_seq'::regclass);


--
-- Name: meeting_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants ALTER COLUMN id SET DEFAULT nextval('public.meeting_participants_id_seq'::regclass);


--
-- Name: meetings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings ALTER COLUMN id SET DEFAULT nextval('public.meetings_id_seq'::regclass);


--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Name: mimir_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_conversations ALTER COLUMN id SET DEFAULT nextval('public.mimir_conversations_id_seq'::regclass);


--
-- Name: mimir_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_messages ALTER COLUMN id SET DEFAULT nextval('public.mimir_messages_id_seq'::regclass);


--
-- Name: mimir_usage_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_usage_log ALTER COLUMN id SET DEFAULT nextval('public.mimir_usage_log_id_seq'::regclass);


--
-- Name: modules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules ALTER COLUMN id SET DEFAULT nextval('public.modules_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: objects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objects ALTER COLUMN id SET DEFAULT nextval('public.objects_id_seq'::regclass);


--
-- Name: office_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.office_expenses ALTER COLUMN id SET DEFAULT nextval('public.office_expenses_id_seq'::regclass);


--
-- Name: one_time_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_time_payments ALTER COLUMN id SET DEFAULT nextval('public.one_time_payments_id_seq'::regclass);


--
-- Name: pass_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pass_requests ALTER COLUMN id SET DEFAULT nextval('public.pass_requests_id_seq'::regclass);


--
-- Name: payment_registry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_registry ALTER COLUMN id SET DEFAULT nextval('public.payment_registry_id_seq'::regclass);


--
-- Name: payroll_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items ALTER COLUMN id SET DEFAULT nextval('public.payroll_items_id_seq'::regclass);


--
-- Name: payroll_sheets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_sheets ALTER COLUMN id SET DEFAULT nextval('public.payroll_sheets_id_seq'::regclass);


--
-- Name: permit_application_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_application_history ALTER COLUMN id SET DEFAULT nextval('public.permit_application_history_id_seq'::regclass);


--
-- Name: permit_application_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_application_items ALTER COLUMN id SET DEFAULT nextval('public.permit_application_items_id_seq'::regclass);


--
-- Name: permit_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_applications ALTER COLUMN id SET DEFAULT nextval('public.permit_applications_id_seq'::regclass);


--
-- Name: permit_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_types ALTER COLUMN id SET DEFAULT nextval('public.permit_types_id_seq'::regclass);


--
-- Name: platform_parse_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_parse_results ALTER COLUMN id SET DEFAULT nextval('public.platform_parse_results_id_seq'::regclass);


--
-- Name: pm_consents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_consents ALTER COLUMN id SET DEFAULT nextval('public.pm_consents_id_seq'::regclass);


--
-- Name: pre_tender_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tender_requests ALTER COLUMN id SET DEFAULT nextval('public.pre_tender_requests_id_seq'::regclass);


--
-- Name: proxies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxies ALTER COLUMN id SET DEFAULT nextval('public.proxies_id_seq'::regclass);


--
-- Name: purchase_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests ALTER COLUMN id SET DEFAULT nextval('public.purchase_requests_id_seq'::regclass);


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- Name: qa_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_messages ALTER COLUMN id SET DEFAULT nextval('public.qa_messages_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders ALTER COLUMN id SET DEFAULT nextval('public.reminders_id_seq'::regclass);


--
-- Name: role_analytics_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_analytics_cache ALTER COLUMN id SET DEFAULT nextval('public.role_analytics_cache_id_seq'::regclass);


--
-- Name: role_presets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_presets ALTER COLUMN id SET DEFAULT nextval('public.role_presets_id_seq'::regclass);


--
-- Name: saved_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports ALTER COLUMN id SET DEFAULT nextval('public.saved_reports_id_seq'::regclass);


--
-- Name: seal_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seal_transfers ALTER COLUMN id SET DEFAULT nextval('public.seal_transfers_id_seq'::regclass);


--
-- Name: seals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seals ALTER COLUMN id SET DEFAULT nextval('public.seals_id_seq'::regclass);


--
-- Name: self_employed id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_employed ALTER COLUMN id SET DEFAULT nextval('public.self_employed_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: site_inspections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_inspections ALTER COLUMN id SET DEFAULT nextval('public.site_inspections_id_seq'::regclass);


--
-- Name: sites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites ALTER COLUMN id SET DEFAULT nextval('public.sites_id_seq'::regclass);


--
-- Name: staff id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff ALTER COLUMN id SET DEFAULT nextval('public.staff_id_seq'::regclass);


--
-- Name: staff_plan id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_plan ALTER COLUMN id SET DEFAULT nextval('public.staff_plan_id_seq'::regclass);


--
-- Name: staff_replacements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_replacements ALTER COLUMN id SET DEFAULT nextval('public.staff_replacements_id_seq'::regclass);


--
-- Name: staff_request_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_request_messages ALTER COLUMN id SET DEFAULT nextval('public.staff_request_messages_id_seq'::regclass);


--
-- Name: staff_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_requests ALTER COLUMN id SET DEFAULT nextval('public.staff_requests_id_seq'::regclass);


--
-- Name: task_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments ALTER COLUMN id SET DEFAULT nextval('public.task_comments_id_seq'::regclass);


--
-- Name: task_watchers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watchers ALTER COLUMN id SET DEFAULT nextval('public.task_watchers_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: telephony_escalations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_escalations ALTER COLUMN id SET DEFAULT nextval('public.telephony_escalations_id_seq'::regclass);


--
-- Name: telephony_events_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_events_log ALTER COLUMN id SET DEFAULT nextval('public.telephony_events_log_id_seq'::regclass);


--
-- Name: telephony_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_jobs ALTER COLUMN id SET DEFAULT nextval('public.telephony_jobs_id_seq'::regclass);


--
-- Name: tenders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenders ALTER COLUMN id SET DEFAULT nextval('public.tenders_id_seq'::regclass);


--
-- Name: tkp id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp ALTER COLUMN id SET DEFAULT nextval('public.tkp_id_seq'::regclass);


--
-- Name: tmc_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tmc_requests ALTER COLUMN id SET DEFAULT nextval('public.tmc_requests_id_seq'::regclass);


--
-- Name: todo_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todo_items ALTER COLUMN id SET DEFAULT nextval('public.todo_items_id_seq'::regclass);


--
-- Name: training_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications ALTER COLUMN id SET DEFAULT nextval('public.training_applications_id_seq'::regclass);


--
-- Name: travel_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travel_expenses ALTER COLUMN id SET DEFAULT nextval('public.travel_expenses_id_seq'::regclass);


--
-- Name: user_call_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_call_status ALTER COLUMN id SET DEFAULT nextval('public.user_call_status_id_seq'::regclass);


--
-- Name: user_email_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_accounts ALTER COLUMN id SET DEFAULT nextval('public.user_email_accounts_id_seq'::regclass);


--
-- Name: user_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_permissions_id_seq'::regclass);


--
-- Name: user_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_requests ALTER COLUMN id SET DEFAULT nextval('public.user_requests_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: warehouses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses ALTER COLUMN id SET DEFAULT nextval('public.warehouses_id_seq'::regclass);


--
-- Name: webauthn_challenges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_challenges ALTER COLUMN id SET DEFAULT nextval('public.webauthn_challenges_id_seq'::regclass);


--
-- Name: work_assign_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_assign_requests ALTER COLUMN id SET DEFAULT nextval('public.work_assign_requests_id_seq'::regclass);


--
-- Name: work_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_expenses ALTER COLUMN id SET DEFAULT nextval('public.work_expenses_id_seq'::regclass);


--
-- Name: work_permit_requirements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_permit_requirements ALTER COLUMN id SET DEFAULT nextval('public.work_permit_requirements_id_seq'::regclass);


--
-- Name: works id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works ALTER COLUMN id SET DEFAULT nextval('public.works_id_seq'::regclass);


--
-- Name: active_calls active_calls_mango_call_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_calls
    ADD CONSTRAINT active_calls_mango_call_id_key UNIQUE (mango_call_id);


--
-- Name: active_calls active_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_calls
    ADD CONSTRAINT active_calls_pkey PRIMARY KEY (id);


--
-- Name: acts acts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acts
    ADD CONSTRAINT acts_pkey PRIMARY KEY (id);


--
-- Name: ai_analysis_log ai_analysis_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_log
    ADD CONSTRAINT ai_analysis_log_pkey PRIMARY KEY (id);


--
-- Name: approval_payment_slips approval_payment_slips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_payment_slips
    ADD CONSTRAINT approval_payment_slips_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: bank_classification_rules bank_classification_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_classification_rules
    ADD CONSTRAINT bank_classification_rules_pkey PRIMARY KEY (id);


--
-- Name: bank_import_batches bank_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_batches
    ADD CONSTRAINT bank_import_batches_pkey PRIMARY KEY (id);


--
-- Name: bank_rules bank_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_rules
    ADD CONSTRAINT bank_rules_pkey PRIMARY KEY (id);


--
-- Name: bank_transactions bank_transactions_import_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_import_hash_key UNIQUE (import_hash);


--
-- Name: bank_transactions bank_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_pkey PRIMARY KEY (id);


--
-- Name: bonus_requests bonus_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_requests
    ADD CONSTRAINT bonus_requests_pkey PRIMARY KEY (id);


--
-- Name: business_trips business_trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_trips
    ADD CONSTRAINT business_trips_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: call_history call_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_history
    ADD CONSTRAINT call_history_pkey PRIMARY KEY (call_id);


--
-- Name: call_routing_rules call_routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_routing_rules
    ADD CONSTRAINT call_routing_rules_pkey PRIMARY KEY (id);


--
-- Name: cash_balance_log cash_balance_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_balance_log
    ADD CONSTRAINT cash_balance_log_pkey PRIMARY KEY (id);


--
-- Name: cash_expenses cash_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_expenses
    ADD CONSTRAINT cash_expenses_pkey PRIMARY KEY (id);


--
-- Name: cash_messages cash_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_messages
    ADD CONSTRAINT cash_messages_pkey PRIMARY KEY (id);


--
-- Name: cash_requests cash_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_requests
    ADD CONSTRAINT cash_requests_pkey PRIMARY KEY (id);


--
-- Name: cash_returns cash_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_returns
    ADD CONSTRAINT cash_returns_pkey PRIMARY KEY (id);


--
-- Name: chat_attachments chat_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_pkey PRIMARY KEY (id);


--
-- Name: chat_group_members chat_group_members_chat_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_group_members
    ADD CONSTRAINT chat_group_members_chat_id_user_id_key UNIQUE (chat_id, user_id);


--
-- Name: chat_group_members chat_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_group_members
    ADD CONSTRAINT chat_group_members_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: correspondence_outgoing_counters correspondence_outgoing_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence_outgoing_counters
    ADD CONSTRAINT correspondence_outgoing_counters_pkey PRIMARY KEY (period_key);


--
-- Name: correspondence correspondence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence
    ADD CONSTRAINT correspondence_pkey PRIMARY KEY (id);


--
-- Name: customer_reviews customer_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reviews
    ADD CONSTRAINT customer_reviews_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: doc_sets doc_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_sets
    ADD CONSTRAINT doc_sets_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_accounts email_accounts_email_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_email_address_key UNIQUE (email_address);


--
-- Name: email_accounts email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);


--
-- Name: email_attachments email_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_pkey PRIMARY KEY (id);


--
-- Name: email_classification_rules email_classification_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_classification_rules
    ADD CONSTRAINT email_classification_rules_pkey PRIMARY KEY (id);


--
-- Name: email_folders email_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_folders
    ADD CONSTRAINT email_folders_pkey PRIMARY KEY (id);


--
-- Name: email_history email_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_history
    ADD CONSTRAINT email_history_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: email_queue email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (id);


--
-- Name: email_sync_log email_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sync_log
    ADD CONSTRAINT email_sync_log_pkey PRIMARY KEY (id);


--
-- Name: email_templates_v2 email_templates_v2_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates_v2
    ADD CONSTRAINT email_templates_v2_code_key UNIQUE (code);


--
-- Name: email_templates_v2 email_templates_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates_v2
    ADD CONSTRAINT email_templates_v2_pkey PRIMARY KEY (id);


--
-- Name: emails emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_pkey PRIMARY KEY (id);


--
-- Name: employee_assignments employee_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_assignments
    ADD CONSTRAINT employee_assignments_pkey PRIMARY KEY (id);


--
-- Name: employee_collection_items employee_collection_items_collection_id_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collection_items
    ADD CONSTRAINT employee_collection_items_collection_id_employee_id_key UNIQUE (collection_id, employee_id);


--
-- Name: employee_collection_items employee_collection_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collection_items
    ADD CONSTRAINT employee_collection_items_pkey PRIMARY KEY (id);


--
-- Name: employee_collections employee_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collections
    ADD CONSTRAINT employee_collections_pkey PRIMARY KEY (id);


--
-- Name: employee_permits employee_permits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permits
    ADD CONSTRAINT employee_permits_pkey PRIMARY KEY (id);


--
-- Name: employee_plan employee_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_plan
    ADD CONSTRAINT employee_plan_pkey PRIMARY KEY (id);


--
-- Name: employee_rates employee_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rates
    ADD CONSTRAINT employee_rates_pkey PRIMARY KEY (id);


--
-- Name: employee_reviews employee_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reviews
    ADD CONSTRAINT employee_reviews_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: equipment_categories equipment_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_categories
    ADD CONSTRAINT equipment_categories_code_key UNIQUE (code);


--
-- Name: equipment_categories equipment_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_categories
    ADD CONSTRAINT equipment_categories_pkey PRIMARY KEY (id);


--
-- Name: equipment equipment_inventory_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_inventory_number_key UNIQUE (inventory_number);


--
-- Name: equipment_kit_items equipment_kit_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kit_items
    ADD CONSTRAINT equipment_kit_items_pkey PRIMARY KEY (id);


--
-- Name: equipment_kits equipment_kits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kits
    ADD CONSTRAINT equipment_kits_pkey PRIMARY KEY (id);


--
-- Name: equipment_maintenance equipment_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance
    ADD CONSTRAINT equipment_maintenance_pkey PRIMARY KEY (id);


--
-- Name: equipment_movements equipment_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_pkey PRIMARY KEY (id);


--
-- Name: equipment equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_pkey PRIMARY KEY (id);


--
-- Name: equipment_requests equipment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_requests
    ADD CONSTRAINT equipment_requests_pkey PRIMARY KEY (id);


--
-- Name: equipment_reservations equipment_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_pkey PRIMARY KEY (id);


--
-- Name: equipment_work_assignments equipment_work_assignments_equipment_id_work_id_assigned_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_work_assignments
    ADD CONSTRAINT equipment_work_assignments_equipment_id_work_id_assigned_at_key UNIQUE (equipment_id, work_id, assigned_at);


--
-- Name: equipment_work_assignments equipment_work_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_work_assignments
    ADD CONSTRAINT equipment_work_assignments_pkey PRIMARY KEY (id);


--
-- Name: erp_connections erp_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_connections
    ADD CONSTRAINT erp_connections_pkey PRIMARY KEY (id);


--
-- Name: erp_field_mappings erp_field_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_field_mappings
    ADD CONSTRAINT erp_field_mappings_pkey PRIMARY KEY (id);


--
-- Name: erp_sync_log erp_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_sync_log
    ADD CONSTRAINT erp_sync_log_pkey PRIMARY KEY (id);


--
-- Name: estimate_approval_events estimate_approval_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_events
    ADD CONSTRAINT estimate_approval_events_pkey PRIMARY KEY (id);


--
-- Name: estimate_approval_requests estimate_approval_requests_estimate_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests
    ADD CONSTRAINT estimate_approval_requests_estimate_id_key UNIQUE (estimate_id);


--
-- Name: estimate_approval_requests estimate_approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests
    ADD CONSTRAINT estimate_approval_requests_pkey PRIMARY KEY (id);


--
-- Name: estimates estimates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: hr_requests hr_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_requests
    ADD CONSTRAINT hr_requests_pkey PRIMARY KEY (id);


--
-- Name: inbox_applications inbox_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_applications
    ADD CONSTRAINT inbox_applications_pkey PRIMARY KEY (id);


--
-- Name: incomes incomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incomes
    ADD CONSTRAINT incomes_pkey PRIMARY KEY (id);


--
-- Name: inventory_checks inventory_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_checks
    ADD CONSTRAINT inventory_checks_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: ivr_audio_cache ivr_audio_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ivr_audio_cache
    ADD CONSTRAINT ivr_audio_cache_pkey PRIMARY KEY (id);


--
-- Name: meeting_minutes meeting_minutes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_pkey PRIMARY KEY (id);


--
-- Name: meeting_participants meeting_participants_meeting_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_meeting_id_user_id_key UNIQUE (meeting_id, user_id);


--
-- Name: meeting_participants meeting_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: mimir_conversations mimir_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_conversations
    ADD CONSTRAINT mimir_conversations_pkey PRIMARY KEY (id);


--
-- Name: mimir_messages mimir_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_messages
    ADD CONSTRAINT mimir_messages_pkey PRIMARY KEY (id);


--
-- Name: mimir_usage_log mimir_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_usage_log
    ADD CONSTRAINT mimir_usage_log_pkey PRIMARY KEY (id);


--
-- Name: modules modules_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_key_key UNIQUE (key);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: office_expenses office_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.office_expenses
    ADD CONSTRAINT office_expenses_pkey PRIMARY KEY (id);


--
-- Name: one_time_payments one_time_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_time_payments
    ADD CONSTRAINT one_time_payments_pkey PRIMARY KEY (id);


--
-- Name: pass_requests pass_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pass_requests
    ADD CONSTRAINT pass_requests_pkey PRIMARY KEY (id);


--
-- Name: payment_registry payment_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_registry
    ADD CONSTRAINT payment_registry_pkey PRIMARY KEY (id);


--
-- Name: payroll_items payroll_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_pkey PRIMARY KEY (id);


--
-- Name: payroll_sheets payroll_sheets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_sheets
    ADD CONSTRAINT payroll_sheets_pkey PRIMARY KEY (id);


--
-- Name: permit_application_history permit_application_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_application_history
    ADD CONSTRAINT permit_application_history_pkey PRIMARY KEY (id);


--
-- Name: permit_application_items permit_application_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_application_items
    ADD CONSTRAINT permit_application_items_pkey PRIMARY KEY (id);


--
-- Name: permit_applications permit_applications_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_applications
    ADD CONSTRAINT permit_applications_number_key UNIQUE (number);


--
-- Name: permit_applications permit_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_applications
    ADD CONSTRAINT permit_applications_pkey PRIMARY KEY (id);


--
-- Name: permit_types permit_types_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_types
    ADD CONSTRAINT permit_types_code_key UNIQUE (code);


--
-- Name: permit_types permit_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_types
    ADD CONSTRAINT permit_types_pkey PRIMARY KEY (id);


--
-- Name: platform_parse_results platform_parse_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_parse_results
    ADD CONSTRAINT platform_parse_results_pkey PRIMARY KEY (id);


--
-- Name: pm_consents pm_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_consents
    ADD CONSTRAINT pm_consents_pkey PRIMARY KEY (id);


--
-- Name: pre_tender_requests pre_tender_requests_email_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tender_requests
    ADD CONSTRAINT pre_tender_requests_email_id_key UNIQUE (email_id);


--
-- Name: pre_tender_requests pre_tender_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tender_requests
    ADD CONSTRAINT pre_tender_requests_pkey PRIMARY KEY (id);


--
-- Name: proxies proxies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxies
    ADD CONSTRAINT proxies_pkey PRIMARY KEY (id);


--
-- Name: purchase_requests purchase_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: qa_messages qa_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_messages
    ADD CONSTRAINT qa_messages_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: role_analytics_cache role_analytics_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_analytics_cache
    ADD CONSTRAINT role_analytics_cache_pkey PRIMARY KEY (id);


--
-- Name: role_analytics_cache role_analytics_cache_role_user_id_metric_key_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_analytics_cache
    ADD CONSTRAINT role_analytics_cache_role_user_id_metric_key_period_key UNIQUE (role, user_id, metric_key, period);


--
-- Name: role_presets role_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_presets
    ADD CONSTRAINT role_presets_pkey PRIMARY KEY (id);


--
-- Name: role_presets role_presets_role_module_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_presets
    ADD CONSTRAINT role_presets_role_module_key_key UNIQUE (role, module_key);


--
-- Name: saved_reports saved_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_pkey PRIMARY KEY (id);


--
-- Name: seal_transfers seal_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seal_transfers
    ADD CONSTRAINT seal_transfers_pkey PRIMARY KEY (id);


--
-- Name: seals seals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seals
    ADD CONSTRAINT seals_pkey PRIMARY KEY (id);


--
-- Name: self_employed self_employed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_employed
    ADD CONSTRAINT self_employed_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: site_inspections site_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_inspections
    ADD CONSTRAINT site_inspections_pkey PRIMARY KEY (id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: staff_plan staff_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_plan
    ADD CONSTRAINT staff_plan_pkey PRIMARY KEY (id);


--
-- Name: staff_replacements staff_replacements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_replacements
    ADD CONSTRAINT staff_replacements_pkey PRIMARY KEY (id);


--
-- Name: staff_request_messages staff_request_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_request_messages
    ADD CONSTRAINT staff_request_messages_pkey PRIMARY KEY (id);


--
-- Name: staff_requests staff_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_requests
    ADD CONSTRAINT staff_requests_pkey PRIMARY KEY (id);


--
-- Name: sync_meta sync_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_meta
    ADD CONSTRAINT sync_meta_pkey PRIMARY KEY (table_name);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: task_watchers task_watchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watchers
    ADD CONSTRAINT task_watchers_pkey PRIMARY KEY (id);


--
-- Name: task_watchers task_watchers_task_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watchers
    ADD CONSTRAINT task_watchers_task_id_user_id_key UNIQUE (task_id, user_id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: telephony_escalations telephony_escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_escalations
    ADD CONSTRAINT telephony_escalations_pkey PRIMARY KEY (id);


--
-- Name: telephony_events_log telephony_events_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_events_log
    ADD CONSTRAINT telephony_events_log_pkey PRIMARY KEY (id);


--
-- Name: telephony_jobs telephony_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_jobs
    ADD CONSTRAINT telephony_jobs_pkey PRIMARY KEY (id);


--
-- Name: tenders tenders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenders
    ADD CONSTRAINT tenders_pkey PRIMARY KEY (id);


--
-- Name: tkp tkp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp
    ADD CONSTRAINT tkp_pkey PRIMARY KEY (id);


--
-- Name: tmc_requests tmc_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tmc_requests
    ADD CONSTRAINT tmc_requests_pkey PRIMARY KEY (id);


--
-- Name: todo_items todo_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todo_items
    ADD CONSTRAINT todo_items_pkey PRIMARY KEY (id);


--
-- Name: training_applications training_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications
    ADD CONSTRAINT training_applications_pkey PRIMARY KEY (id);


--
-- Name: travel_expenses travel_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travel_expenses
    ADD CONSTRAINT travel_expenses_pkey PRIMARY KEY (id);


--
-- Name: user_call_status user_call_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_call_status
    ADD CONSTRAINT user_call_status_pkey PRIMARY KEY (user_id);


--
-- Name: user_dashboard user_dashboard_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dashboard
    ADD CONSTRAINT user_dashboard_pkey PRIMARY KEY (user_id);


--
-- Name: user_email_accounts user_email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_accounts
    ADD CONSTRAINT user_email_accounts_pkey PRIMARY KEY (id);


--
-- Name: user_email_accounts user_email_accounts_user_id_email_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_accounts
    ADD CONSTRAINT user_email_accounts_user_id_email_address_key UNIQUE (user_id, email_address);


--
-- Name: user_menu_settings user_menu_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_menu_settings
    ADD CONSTRAINT user_menu_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_user_id_module_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_module_key_key UNIQUE (user_id, module_key);


--
-- Name: user_requests user_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_requests
    ADD CONSTRAINT user_requests_pkey PRIMARY KEY (id);


--
-- Name: users users_login_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_login_key UNIQUE (login);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: warehouses warehouses_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_code_key UNIQUE (code);


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: work_assign_requests work_assign_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_assign_requests
    ADD CONSTRAINT work_assign_requests_pkey PRIMARY KEY (id);


--
-- Name: work_expenses work_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_expenses
    ADD CONSTRAINT work_expenses_pkey PRIMARY KEY (id);


--
-- Name: work_permit_requirements work_permit_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_permit_requirements
    ADD CONSTRAINT work_permit_requirements_pkey PRIMARY KEY (id);


--
-- Name: works works_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works
    ADD CONSTRAINT works_pkey PRIMARY KEY (id);


--
-- Name: customers_inn_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_inn_unique ON public.customers USING btree (inn) WHERE ((inn IS NOT NULL) AND ((inn)::text <> ''::text));


--
-- Name: customers_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_name_unique ON public.customers USING btree (name);


--
-- Name: idx_active_calls_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_calls_state ON public.active_calls USING btree (call_state);


--
-- Name: idx_active_calls_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_calls_user ON public.active_calls USING btree (assigned_user_id);


--
-- Name: idx_ai_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_log_created ON public.ai_analysis_log USING btree (created_at DESC);


--
-- Name: idx_ai_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_log_entity ON public.ai_analysis_log USING btree (entity_type, entity_id);


--
-- Name: idx_approval_payment_slips_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_payment_slips_request_id ON public.approval_payment_slips USING btree (request_id, id);


--
-- Name: idx_approval_payment_slips_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_payment_slips_source ON public.approval_payment_slips USING btree (source_type, source_id, id);


--
-- Name: idx_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_actor ON public.audit_log USING btree (actor_user_id);


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created ON public.audit_log USING btree (created_at);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_log_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_user_id);


--
-- Name: idx_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_bank_rules_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_rules_pattern ON public.bank_classification_rules USING btree (pattern);


--
-- Name: idx_bank_tx_article; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_tx_article ON public.bank_transactions USING btree (article);


--
-- Name: idx_bank_tx_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_tx_batch ON public.bank_transactions USING btree (batch_id);


--
-- Name: idx_bank_tx_counterparty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_tx_counterparty ON public.bank_transactions USING btree (counterparty_inn);


--
-- Name: idx_bank_tx_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_tx_date ON public.bank_transactions USING btree (transaction_date DESC);


--
-- Name: idx_bank_tx_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_tx_hash ON public.bank_transactions USING btree (import_hash);


--
-- Name: idx_bank_tx_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_tx_status ON public.bank_transactions USING btree (status);


--
-- Name: idx_business_trips_inspection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_trips_inspection ON public.business_trips USING btree (inspection_id);


--
-- Name: idx_business_trips_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_trips_status ON public.business_trips USING btree (status);


--
-- Name: idx_business_trips_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_trips_work ON public.business_trips USING btree (work_id);


--
-- Name: idx_calendar_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_date ON public.calendar_events USING btree (date);


--
-- Name: idx_calendar_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_type ON public.calendar_events USING btree (type);


--
-- Name: idx_call_history_call_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_call_type ON public.call_history USING btree (call_type);


--
-- Name: idx_call_history_client_inn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_client_inn ON public.call_history USING btree (client_inn);


--
-- Name: idx_call_history_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_created_at ON public.call_history USING btree (created_at DESC);


--
-- Name: idx_call_history_from_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_from_number ON public.call_history USING btree (from_number);


--
-- Name: idx_call_history_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_call_history_id ON public.call_history USING btree (id);


--
-- Name: idx_call_history_mango_call; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_mango_call ON public.call_history USING btree (mango_call_id);


--
-- Name: idx_call_history_mango_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_mango_entry ON public.call_history USING btree (mango_entry_id);


--
-- Name: idx_call_history_missed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_missed ON public.call_history USING btree (call_type, missed_acknowledged) WHERE ((call_type)::text = 'missed'::text);


--
-- Name: idx_call_history_to_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_to_number ON public.call_history USING btree (to_number);


--
-- Name: idx_call_history_transcript_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_transcript_status ON public.call_history USING btree (transcript_status) WHERE ((transcript_status)::text <> 'none'::text);


--
-- Name: idx_call_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_user_id ON public.call_history USING btree (user_id);


--
-- Name: idx_cash_balance_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_balance_log_created ON public.cash_balance_log USING btree (created_at DESC);


--
-- Name: idx_cash_expenses_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_expenses_request ON public.cash_expenses USING btree (request_id);


--
-- Name: idx_cash_messages_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_messages_request ON public.cash_messages USING btree (request_id);


--
-- Name: idx_cash_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_requests_status ON public.cash_requests USING btree (status);


--
-- Name: idx_cash_requests_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_requests_user ON public.cash_requests USING btree (user_id);


--
-- Name: idx_cash_requests_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_requests_work ON public.cash_requests USING btree (work_id);


--
-- Name: idx_cash_returns_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_returns_request ON public.cash_returns USING btree (request_id);


--
-- Name: idx_chat_attachments_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_attachments_message ON public.chat_attachments USING btree (message_id);


--
-- Name: idx_chat_group_members_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_group_members_chat ON public.chat_group_members USING btree (chat_id);


--
-- Name: idx_chat_group_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_group_members_user ON public.chat_group_members USING btree (user_id);


--
-- Name: idx_chat_messages_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_chat_id ON public.chat_messages USING btree (chat_id);


--
-- Name: idx_chat_messages_chat_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_chat_type ON public.chat_messages USING btree (chat_type);


--
-- Name: idx_chat_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_created ON public.chat_messages USING btree (created_at);


--
-- Name: idx_chat_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at);


--
-- Name: idx_chat_messages_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_entity_id ON public.chat_messages USING btree (entity_id);


--
-- Name: idx_chat_messages_reply; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_reply ON public.chat_messages USING btree (reply_to_id);


--
-- Name: idx_chat_messages_to_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_to_user_id ON public.chat_messages USING btree (to_user_id);


--
-- Name: idx_chat_messages_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_type ON public.chat_messages USING btree (chat_type);


--
-- Name: idx_chat_messages_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_updated ON public.chat_messages USING btree (updated_at);


--
-- Name: idx_chat_messages_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_user_id ON public.chat_messages USING btree (user_id);


--
-- Name: idx_chats_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_archived ON public.chats USING btree (archived_at);


--
-- Name: idx_chats_is_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_is_group ON public.chats USING btree (is_group);


--
-- Name: idx_chats_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_last_message ON public.chats USING btree (last_message_at DESC);


--
-- Name: idx_correspondence_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_correspondence_date ON public.correspondence USING btree (date);


--
-- Name: idx_correspondence_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_correspondence_direction ON public.correspondence USING btree (direction);


--
-- Name: idx_correspondence_email_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_correspondence_email_id ON public.correspondence USING btree (email_id);


--
-- Name: idx_correspondence_inbox_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_correspondence_inbox_app ON public.correspondence USING btree (linked_inbox_application_id) WHERE (linked_inbox_application_id IS NOT NULL);


--
-- Name: idx_correspondence_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_correspondence_number ON public.correspondence USING btree (number) WHERE ((number IS NOT NULL) AND ((number)::text <> ''::text));


--
-- Name: idx_customers_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_customers_id ON public.customers USING btree (id);


--
-- Name: idx_customers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name ON public.customers USING btree (name);


--
-- Name: idx_documents_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_tender ON public.documents USING btree (tender_id);


--
-- Name: idx_documents_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_work ON public.documents USING btree (work_id);


--
-- Name: idx_ecol_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecol_active ON public.employee_collections USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_ecol_items_coll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecol_items_coll ON public.employee_collection_items USING btree (collection_id);


--
-- Name: idx_ecol_items_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecol_items_emp ON public.employee_collection_items USING btree (employee_id);


--
-- Name: idx_email_attachments_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_attachments_email ON public.email_attachments USING btree (email_id);


--
-- Name: idx_email_folders_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_folders_account ON public.email_folders USING btree (account_id);


--
-- Name: idx_email_folders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_folders_user ON public.email_folders USING btree (user_account_id, sort_order);


--
-- Name: idx_email_folders_user_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_folders_user_account ON public.email_folders USING btree (user_account_id);


--
-- Name: idx_email_sync_log_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_sync_log_account ON public.email_sync_log USING btree (account_id, started_at DESC);


--
-- Name: idx_emails_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_account ON public.emails USING btree (account_id);


--
-- Name: idx_emails_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_date ON public.emails USING btree (email_date DESC);


--
-- Name: idx_emails_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_direction ON public.emails USING btree (direction);


--
-- Name: idx_emails_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_folder ON public.emails USING btree (folder_id);


--
-- Name: idx_emails_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_from ON public.emails USING btree (from_email);


--
-- Name: idx_emails_imap_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_imap_uid ON public.emails USING btree (account_id, imap_uid);


--
-- Name: idx_emails_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_list ON public.emails USING btree (direction, is_deleted, is_archived, email_date DESC);


--
-- Name: idx_emails_message_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_emails_message_id_unique ON public.emails USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: idx_emails_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_owner ON public.emails USING btree (owner_user_id);


--
-- Name: idx_emails_starred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_starred ON public.emails USING btree (is_starred) WHERE (is_starred = true);


--
-- Name: idx_emails_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_thread ON public.emails USING btree (thread_id) WHERE (thread_id IS NOT NULL);


--
-- Name: idx_emails_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_type ON public.emails USING btree (email_type);


--
-- Name: idx_emails_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_unread ON public.emails USING btree (is_read) WHERE ((is_read = false) AND (is_deleted = false));


--
-- Name: idx_emails_user_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_user_account ON public.emails USING btree (user_account_id);


--
-- Name: idx_emails_user_account_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_user_account_date ON public.emails USING btree (user_account_id, email_date DESC);


--
-- Name: idx_emails_user_account_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emails_user_account_folder ON public.emails USING btree (user_account_id, folder_id, is_deleted, is_draft);


--
-- Name: idx_employee_plan_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_plan_date ON public.employee_plan USING btree (date);


--
-- Name: idx_employee_plan_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_plan_employee ON public.employee_plan USING btree (employee_id);


--
-- Name: idx_employee_rates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_rates_active ON public.employee_rates USING btree (employee_id) WHERE (effective_to IS NULL);


--
-- Name: idx_employee_rates_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_rates_emp ON public.employee_rates USING btree (employee_id);


--
-- Name: idx_employees_fio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_fio ON public.employees USING btree (fio);


--
-- Name: idx_employees_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_role ON public.employees USING btree (role_tag);


--
-- Name: idx_employees_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_user ON public.employees USING btree (user_id);


--
-- Name: idx_equipment_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_category ON public.equipment USING btree (category_id);


--
-- Name: idx_equipment_holder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_holder ON public.equipment USING btree (current_holder_id);


--
-- Name: idx_equipment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_status ON public.equipment USING btree (status);


--
-- Name: idx_equipment_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_warehouse ON public.equipment USING btree (warehouse_id);


--
-- Name: idx_equipment_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_work ON public.equipment USING btree (work_id) WHERE (work_id IS NOT NULL);


--
-- Name: idx_erp_field_map; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_erp_field_map ON public.erp_field_mappings USING btree (connection_id, entity_type);


--
-- Name: idx_erp_sync_log_conn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_erp_sync_log_conn ON public.erp_sync_log USING btree (connection_id);


--
-- Name: idx_erp_sync_log_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_erp_sync_log_date ON public.erp_sync_log USING btree (started_at DESC);


--
-- Name: idx_estimate_approval_events_estimate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_approval_events_estimate_id ON public.estimate_approval_events USING btree (estimate_id, id);


--
-- Name: idx_estimate_approval_events_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_approval_events_request_id ON public.estimate_approval_events USING btree (request_id, id);


--
-- Name: idx_estimate_approval_requests_pm_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_approval_requests_pm_id ON public.estimate_approval_requests USING btree (pm_id);


--
-- Name: idx_estimate_approval_requests_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_approval_requests_source ON public.estimate_approval_requests USING btree (source_type, source_id);


--
-- Name: idx_estimate_approval_requests_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_approval_requests_stage ON public.estimate_approval_requests USING btree (current_stage);


--
-- Name: idx_estimate_approval_requests_tender_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_approval_requests_tender_id ON public.estimate_approval_requests USING btree (tender_id);


--
-- Name: idx_estimates_pm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimates_pm ON public.estimates USING btree (pm_id);


--
-- Name: idx_estimates_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimates_status ON public.estimates USING btree (approval_status);


--
-- Name: idx_estimates_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimates_tender ON public.estimates USING btree (tender_id);


--
-- Name: idx_ewa_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ewa_equipment ON public.equipment_work_assignments USING btree (equipment_id);


--
-- Name: idx_ewa_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ewa_status ON public.equipment_work_assignments USING btree (status);


--
-- Name: idx_ewa_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ewa_work ON public.equipment_work_assignments USING btree (work_id);


--
-- Name: idx_inbox_app_color; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_app_color ON public.inbox_applications USING btree (ai_color);


--
-- Name: idx_inbox_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_app_created ON public.inbox_applications USING btree (created_at DESC);


--
-- Name: idx_inbox_app_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_app_email ON public.inbox_applications USING btree (email_id);


--
-- Name: idx_inbox_app_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_app_status ON public.inbox_applications USING btree (status);


--
-- Name: idx_inbox_app_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_app_tender ON public.inbox_applications USING btree (linked_tender_id);


--
-- Name: idx_incomes_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incomes_date ON public.incomes USING btree (date);


--
-- Name: idx_incomes_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incomes_hash ON public.incomes USING btree (import_hash);


--
-- Name: idx_incomes_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incomes_type ON public.incomes USING btree (type);


--
-- Name: idx_incomes_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incomes_work ON public.incomes USING btree (work_id);


--
-- Name: idx_invoices_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_source ON public.invoices USING btree (source);


--
-- Name: idx_invoices_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_tender ON public.invoices USING btree (tender_id);


--
-- Name: idx_invoices_tkp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_tkp ON public.invoices USING btree (tkp_id);


--
-- Name: idx_ivr_cache_hash_voice; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ivr_cache_hash_voice ON public.ivr_audio_cache USING btree (text_hash, voice);


--
-- Name: idx_kit_items_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_items_equipment ON public.equipment_kit_items USING btree (equipment_id);


--
-- Name: idx_kit_items_kit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_items_kit ON public.equipment_kit_items USING btree (kit_id);


--
-- Name: idx_meeting_minutes_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_minutes_meeting ON public.meeting_minutes USING btree (meeting_id);


--
-- Name: idx_meeting_minutes_responsible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_minutes_responsible ON public.meeting_minutes USING btree (responsible_user_id);


--
-- Name: idx_meeting_minutes_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_minutes_task ON public.meeting_minutes USING btree (task_id);


--
-- Name: idx_meeting_participants_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_participants_meeting ON public.meeting_participants USING btree (meeting_id);


--
-- Name: idx_meeting_participants_rsvp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_participants_rsvp ON public.meeting_participants USING btree (rsvp_status);


--
-- Name: idx_meeting_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_participants_user ON public.meeting_participants USING btree (user_id);


--
-- Name: idx_meetings_organizer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_organizer ON public.meetings USING btree (organizer_id);


--
-- Name: idx_meetings_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_start ON public.meetings USING btree (start_time);


--
-- Name: idx_meetings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_status ON public.meetings USING btree (status);


--
-- Name: idx_meetings_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_tender ON public.meetings USING btree (tender_id);


--
-- Name: idx_meetings_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_work ON public.meetings USING btree (work_id);


--
-- Name: idx_mimir_conv_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mimir_conv_archived ON public.mimir_conversations USING btree (user_id, is_archived);


--
-- Name: idx_mimir_conv_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mimir_conv_updated ON public.mimir_conversations USING btree (updated_at DESC);


--
-- Name: idx_mimir_conv_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mimir_conv_user_id ON public.mimir_conversations USING btree (user_id);


--
-- Name: idx_mimir_msg_conv_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mimir_msg_conv_id ON public.mimir_messages USING btree (conversation_id);


--
-- Name: idx_mimir_msg_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mimir_msg_created ON public.mimir_messages USING btree (conversation_id, created_at);


--
-- Name: idx_mimir_usage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mimir_usage_created ON public.mimir_usage_log USING btree (created_at);


--
-- Name: idx_mimir_usage_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mimir_usage_user ON public.mimir_usage_log USING btree (user_id);


--
-- Name: idx_notifications_link_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_link_hash ON public.notifications USING btree (link_hash);


--
-- Name: idx_notifications_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_read ON public.notifications USING btree (is_read);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (type);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- Name: idx_office_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_office_expenses_date ON public.office_expenses USING btree (date);


--
-- Name: idx_office_expenses_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_office_expenses_hash ON public.office_expenses USING btree (import_hash);


--
-- Name: idx_office_expenses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_office_expenses_status ON public.office_expenses USING btree (status);


--
-- Name: idx_one_time_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_time_employee ON public.one_time_payments USING btree (employee_id);


--
-- Name: idx_one_time_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_time_status ON public.one_time_payments USING btree (status);


--
-- Name: idx_one_time_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_one_time_work ON public.one_time_payments USING btree (work_id);


--
-- Name: idx_pass_requests_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pass_requests_dates ON public.pass_requests USING btree (date_from, date_to);


--
-- Name: idx_pass_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pass_requests_status ON public.pass_requests USING btree (status);


--
-- Name: idx_pass_requests_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pass_requests_tender ON public.pass_requests USING btree (tender_id);


--
-- Name: idx_payment_registry_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_registry_employee ON public.payment_registry USING btree (employee_id);


--
-- Name: idx_payment_registry_sheet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_registry_sheet ON public.payment_registry USING btree (sheet_id);


--
-- Name: idx_payment_registry_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_registry_status ON public.payment_registry USING btree (status);


--
-- Name: idx_payroll_items_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_items_employee ON public.payroll_items USING btree (employee_id);


--
-- Name: idx_payroll_items_sheet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_items_sheet ON public.payroll_items USING btree (sheet_id);


--
-- Name: idx_payroll_sheets_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_sheets_period ON public.payroll_sheets USING btree (period_from, period_to);


--
-- Name: idx_payroll_sheets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_sheets_status ON public.payroll_sheets USING btree (status);


--
-- Name: idx_payroll_sheets_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_sheets_work ON public.payroll_sheets USING btree (work_id);


--
-- Name: idx_permit_app_contractor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_app_contractor ON public.permit_applications USING btree (contractor_name);


--
-- Name: idx_permit_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_app_created ON public.permit_applications USING btree (created_at DESC);


--
-- Name: idx_permit_app_hist_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_app_hist_app ON public.permit_application_history USING btree (application_id);


--
-- Name: idx_permit_app_items_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_app_items_app ON public.permit_application_items USING btree (application_id);


--
-- Name: idx_permit_app_items_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_app_items_emp ON public.permit_application_items USING btree (employee_id);


--
-- Name: idx_permit_app_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_app_status ON public.permit_applications USING btree (status);


--
-- Name: idx_permit_types_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_types_active ON public.permit_types USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_permit_types_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permit_types_category ON public.permit_types USING btree (category);


--
-- Name: idx_permits_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permits_active ON public.employee_permits USING btree (is_active);


--
-- Name: idx_permits_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permits_employee ON public.employee_permits USING btree (employee_id);


--
-- Name: idx_permits_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permits_expiry ON public.employee_permits USING btree (expiry_date);


--
-- Name: idx_permits_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permits_type ON public.employee_permits USING btree (type_id);


--
-- Name: idx_plan_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_date ON public.employee_plan USING btree (date);


--
-- Name: idx_plan_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_employee ON public.employee_plan USING btree (employee_id);


--
-- Name: idx_platform_parse_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_parse_deadline ON public.platform_parse_results USING btree (application_deadline);


--
-- Name: idx_platform_parse_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_parse_email ON public.platform_parse_results USING btree (email_id);


--
-- Name: idx_platform_parse_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_parse_number ON public.platform_parse_results USING btree (purchase_number);


--
-- Name: idx_platform_parse_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_parse_platform ON public.platform_parse_results USING btree (platform_code);


--
-- Name: idx_platform_parse_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_parse_status ON public.platform_parse_results USING btree (parse_status);


--
-- Name: idx_pre_tender_color; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pre_tender_color ON public.pre_tender_requests USING btree (ai_color);


--
-- Name: idx_pre_tender_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pre_tender_date ON public.pre_tender_requests USING btree (created_at DESC);


--
-- Name: idx_pre_tender_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pre_tender_email ON public.pre_tender_requests USING btree (email_id);


--
-- Name: idx_pre_tender_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pre_tender_status ON public.pre_tender_requests USING btree (status);


--
-- Name: idx_pre_tender_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pre_tender_tender ON public.pre_tender_requests USING btree (created_tender_id);


--
-- Name: idx_push_sub_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_sub_user_id ON public.push_subscriptions USING btree (user_id);


--
-- Name: idx_reminders_auto_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_auto_key ON public.reminders USING btree (auto_key) WHERE (auto_key IS NOT NULL);


--
-- Name: idx_reminders_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_completed ON public.reminders USING btree (completed, completed_at) WHERE (completed = true);


--
-- Name: idx_reminders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_user_id ON public.reminders USING btree (user_id);


--
-- Name: idx_reviews_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_employee ON public.employee_reviews USING btree (employee_id);


--
-- Name: idx_role_analytics_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_analytics_role ON public.role_analytics_cache USING btree (role);


--
-- Name: idx_role_analytics_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_analytics_user ON public.role_analytics_cache USING btree (user_id);


--
-- Name: idx_role_presets_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_presets_role ON public.role_presets USING btree (role);


--
-- Name: idx_routing_rules_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_rules_active ON public.call_routing_rules USING btree (is_active, priority DESC);


--
-- Name: idx_seal_transfers_seal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seal_transfers_seal ON public.seal_transfers USING btree (seal_id);


--
-- Name: idx_seal_transfers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seal_transfers_status ON public.seal_transfers USING btree (status);


--
-- Name: idx_seals_holder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seals_holder ON public.seals USING btree (holder_id);


--
-- Name: idx_seals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seals_status ON public.seals USING btree (status);


--
-- Name: idx_self_employed_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_employed_employee ON public.self_employed USING btree (employee_id);


--
-- Name: idx_self_employed_inn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_employed_inn ON public.self_employed USING btree (inn);


--
-- Name: idx_settings_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_settings_key ON public.settings USING btree (key);


--
-- Name: idx_site_inspections_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_inspections_author ON public.site_inspections USING btree (author_id);


--
-- Name: idx_site_inspections_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_inspections_status ON public.site_inspections USING btree (status);


--
-- Name: idx_site_inspections_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_inspections_tender ON public.site_inspections USING btree (tender_id);


--
-- Name: idx_site_inspections_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_inspections_work ON public.site_inspections USING btree (work_id);


--
-- Name: idx_sites_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sites_customer ON public.sites USING btree (customer_id);


--
-- Name: idx_sites_geocode_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sites_geocode_status ON public.sites USING btree (geocode_status);


--
-- Name: idx_sites_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sites_region ON public.sites USING btree (region);


--
-- Name: idx_staff_plan_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_plan_date ON public.staff_plan USING btree (date);


--
-- Name: idx_staff_plan_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_plan_staff ON public.staff_plan USING btree (staff_id);


--
-- Name: idx_task_comments_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_created ON public.task_comments USING btree (created_at);


--
-- Name: idx_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_task ON public.task_comments USING btree (task_id);


--
-- Name: idx_task_comments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_user ON public.task_comments USING btree (user_id);


--
-- Name: idx_task_watchers_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_watchers_task ON public.task_watchers USING btree (task_id);


--
-- Name: idx_task_watchers_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_watchers_user ON public.task_watchers USING btree (user_id);


--
-- Name: idx_tasks_acknowledged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_acknowledged ON public.tasks USING btree (acknowledged_at);


--
-- Name: idx_tasks_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_archived ON public.tasks USING btree (archived_at);


--
-- Name: idx_tasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assignee ON public.tasks USING btree (assignee_id);


--
-- Name: idx_tasks_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_creator ON public.tasks USING btree (creator_id);


--
-- Name: idx_tasks_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_deadline ON public.tasks USING btree (deadline);


--
-- Name: idx_tasks_kanban; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_kanban ON public.tasks USING btree (kanban_column, kanban_position);


--
-- Name: idx_tasks_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_parent ON public.tasks USING btree (parent_task_id);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_tasks_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_tender ON public.tasks USING btree (tender_id);


--
-- Name: idx_tasks_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_work ON public.tasks USING btree (work_id);


--
-- Name: idx_tel_events_call_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tel_events_call_id ON public.telephony_events_log USING btree (mango_call_id);


--
-- Name: idx_tel_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tel_events_created ON public.telephony_events_log USING btree (created_at DESC);


--
-- Name: idx_tel_events_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tel_events_unprocessed ON public.telephony_events_log USING btree (processed) WHERE (processed = false);


--
-- Name: idx_telephony_escalations_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telephony_escalations_pending ON public.telephony_escalations USING btree (deadline_at) WHERE ((escalated = false) AND (acknowledged = false));


--
-- Name: idx_telephony_jobs_call_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telephony_jobs_call_id ON public.telephony_jobs USING btree (call_id);


--
-- Name: idx_telephony_jobs_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telephony_jobs_scheduled ON public.telephony_jobs USING btree (scheduled_at) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'retry'::character varying])::text[]));


--
-- Name: idx_telephony_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telephony_jobs_status ON public.telephony_jobs USING btree (status) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'retry'::character varying])::text[]));


--
-- Name: idx_tenders_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenders_customer ON public.tenders USING btree (customer_inn);


--
-- Name: idx_tenders_draft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenders_draft ON public.tenders USING btree (tender_status) WHERE ((tender_status)::text = 'Черновик'::text);


--
-- Name: idx_tenders_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenders_period ON public.tenders USING btree (period);


--
-- Name: idx_tenders_pm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenders_pm ON public.tenders USING btree (responsible_pm_id);


--
-- Name: idx_tenders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenders_status ON public.tenders USING btree (tender_status);


--
-- Name: idx_tenders_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenders_year ON public.tenders USING btree (year);


--
-- Name: idx_tkp_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tkp_author ON public.tkp USING btree (author_id);


--
-- Name: idx_tkp_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tkp_number ON public.tkp USING btree (tkp_number);


--
-- Name: idx_tkp_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tkp_source ON public.tkp USING btree (source);


--
-- Name: idx_tkp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tkp_status ON public.tkp USING btree (status);


--
-- Name: idx_tkp_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tkp_tender ON public.tkp USING btree (tender_id);


--
-- Name: idx_tmc_requests_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tmc_requests_priority ON public.tmc_requests USING btree (priority);


--
-- Name: idx_tmc_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tmc_requests_status ON public.tmc_requests USING btree (status);


--
-- Name: idx_tmc_requests_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tmc_requests_work ON public.tmc_requests USING btree (work_id);


--
-- Name: idx_todo_done; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_todo_done ON public.todo_items USING btree (user_id, done);


--
-- Name: idx_todo_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_todo_user ON public.todo_items USING btree (user_id);


--
-- Name: idx_training_app_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_app_status ON public.training_applications USING btree (status);


--
-- Name: idx_training_app_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_app_user ON public.training_applications USING btree (user_id);


--
-- Name: idx_travel_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_travel_date ON public.travel_expenses USING btree (date);


--
-- Name: idx_travel_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_travel_expenses_date ON public.travel_expenses USING btree (date);


--
-- Name: idx_travel_expenses_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_travel_expenses_emp ON public.travel_expenses USING btree (employee_id);


--
-- Name: idx_travel_expenses_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_travel_expenses_work ON public.travel_expenses USING btree (work_id);


--
-- Name: idx_travel_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_travel_work ON public.travel_expenses USING btree (work_id);


--
-- Name: idx_user_email_accounts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_email_accounts_active ON public.user_email_accounts USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_user_email_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_email_accounts_user ON public.user_email_accounts USING btree (user_id);


--
-- Name: idx_user_permissions_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_permissions_module ON public.user_permissions USING btree (module_key);


--
-- Name: idx_user_permissions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_permissions_user ON public.user_permissions USING btree (user_id);


--
-- Name: idx_user_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_requests_status ON public.user_requests USING btree (status);


--
-- Name: idx_users_login; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_login ON public.users USING btree (login);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_telegram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_telegram ON public.users USING btree (telegram_chat_id);


--
-- Name: idx_webauthn_cred_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webauthn_cred_id ON public.webauthn_credentials USING btree (credential_id);


--
-- Name: idx_webauthn_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webauthn_user_id ON public.webauthn_credentials USING btree (user_id);


--
-- Name: idx_work_expenses_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_expenses_category ON public.work_expenses USING btree (category);


--
-- Name: idx_work_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_expenses_date ON public.work_expenses USING btree (date);


--
-- Name: idx_work_expenses_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_expenses_work ON public.work_expenses USING btree (work_id);


--
-- Name: idx_work_permit_req_work; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_permit_req_work ON public.work_permit_requirements USING btree (work_id);


--
-- Name: idx_works_pm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_works_pm ON public.works USING btree (pm_id);


--
-- Name: idx_works_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_works_status ON public.works USING btree (work_status);


--
-- Name: idx_works_tender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_works_tender ON public.works USING btree (tender_id);


--
-- Name: idx_works_work_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_works_work_status ON public.works USING btree (work_status);


--
-- Name: uq_approval_payment_slips_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_approval_payment_slips_document_id ON public.approval_payment_slips USING btree (document_id);


--
-- Name: invoices trg_generate_invoice_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_generate_invoice_number BEFORE INSERT ON public.invoices FOR EACH ROW WHEN (((new.invoice_number IS NULL) OR ((new.invoice_number)::text = ''::text))) EXECUTE FUNCTION public.generate_invoice_number();


--
-- Name: tkp trg_generate_tkp_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_generate_tkp_number BEFORE INSERT ON public.tkp FOR EACH ROW WHEN ((new.tkp_number IS NULL)) EXECUTE FUNCTION public.generate_tkp_number();


--
-- Name: mimir_conversations trg_mimir_conversation_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mimir_conversation_updated BEFORE UPDATE ON public.mimir_conversations FOR EACH ROW EXECUTE FUNCTION public.update_mimir_conversation_timestamp();


--
-- Name: permit_applications trg_permit_app_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_permit_app_number BEFORE INSERT ON public.permit_applications FOR EACH ROW WHEN ((new.number IS NULL)) EXECUTE FUNCTION public.generate_permit_app_number();


--
-- Name: works trg_sync_contract_values; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_contract_values BEFORE INSERT OR UPDATE ON public.works FOR EACH ROW EXECUTE FUNCTION public.sync_contract_values();


--
-- Name: works trg_sync_employee_assignments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_employee_assignments AFTER UPDATE ON public.works FOR EACH ROW EXECUTE FUNCTION public.sync_employee_assignments();


--
-- Name: works trg_sync_employee_assignments_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_employee_assignments_insert AFTER INSERT ON public.works FOR EACH ROW WHEN ((new.staff_ids_json IS NOT NULL)) EXECUTE FUNCTION public.sync_employee_assignments();


--
-- Name: active_calls active_calls_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_calls
    ADD CONSTRAINT active_calls_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id);


--
-- Name: ai_analysis_log ai_analysis_log_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_log
    ADD CONSTRAINT ai_analysis_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: approval_payment_slips approval_payment_slips_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_payment_slips
    ADD CONSTRAINT approval_payment_slips_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: approval_payment_slips approval_payment_slips_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_payment_slips
    ADD CONSTRAINT approval_payment_slips_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.estimate_approval_requests(id) ON DELETE CASCADE;


--
-- Name: approval_payment_slips approval_payment_slips_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_payment_slips
    ADD CONSTRAINT approval_payment_slips_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: bank_import_batches bank_import_batches_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_batches
    ADD CONSTRAINT bank_import_batches_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(id);


--
-- Name: bank_transactions bank_transactions_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: bank_transactions bank_transactions_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(id);


--
-- Name: bank_transactions bank_transactions_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: bank_transactions bank_transactions_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: bonus_requests bonus_requests_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_requests
    ADD CONSTRAINT bonus_requests_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id);


--
-- Name: business_trips business_trips_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_trips
    ADD CONSTRAINT business_trips_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: business_trips business_trips_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_trips
    ADD CONSTRAINT business_trips_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.site_inspections(id) ON DELETE SET NULL;


--
-- Name: business_trips business_trips_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_trips
    ADD CONSTRAINT business_trips_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: calendar_events calendar_events_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: calendar_events calendar_events_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: call_routing_rules call_routing_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_routing_rules
    ADD CONSTRAINT call_routing_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: cash_balance_log cash_balance_log_related_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_balance_log
    ADD CONSTRAINT cash_balance_log_related_request_id_fkey FOREIGN KEY (related_request_id) REFERENCES public.cash_requests(id);


--
-- Name: cash_balance_log cash_balance_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_balance_log
    ADD CONSTRAINT cash_balance_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: cash_expenses cash_expenses_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_expenses
    ADD CONSTRAINT cash_expenses_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.cash_requests(id) ON DELETE CASCADE;


--
-- Name: cash_messages cash_messages_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_messages
    ADD CONSTRAINT cash_messages_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.cash_requests(id) ON DELETE CASCADE;


--
-- Name: cash_messages cash_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_messages
    ADD CONSTRAINT cash_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: cash_requests cash_requests_director_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_requests
    ADD CONSTRAINT cash_requests_director_id_fkey FOREIGN KEY (director_id) REFERENCES public.users(id);


--
-- Name: cash_requests cash_requests_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_requests
    ADD CONSTRAINT cash_requests_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id);


--
-- Name: cash_requests cash_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_requests
    ADD CONSTRAINT cash_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: cash_requests cash_requests_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_requests
    ADD CONSTRAINT cash_requests_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: cash_returns cash_returns_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_returns
    ADD CONSTRAINT cash_returns_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: cash_returns cash_returns_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_returns
    ADD CONSTRAINT cash_returns_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.cash_requests(id) ON DELETE CASCADE;


--
-- Name: chat_attachments chat_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_group_members chat_group_members_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_group_members
    ADD CONSTRAINT chat_group_members_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_group_members chat_group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_group_members
    ADD CONSTRAINT chat_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_reply_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES public.chat_messages(id);


--
-- Name: chat_messages chat_messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.chat_messages(id);


--
-- Name: correspondence correspondence_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence
    ADD CONSTRAINT correspondence_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: correspondence correspondence_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence
    ADD CONSTRAINT correspondence_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE SET NULL;


--
-- Name: correspondence correspondence_linked_inbox_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence
    ADD CONSTRAINT correspondence_linked_inbox_application_id_fkey FOREIGN KEY (linked_inbox_application_id) REFERENCES public.inbox_applications(id);


--
-- Name: correspondence correspondence_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence
    ADD CONSTRAINT correspondence_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: correspondence correspondence_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondence
    ADD CONSTRAINT correspondence_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: documents documents_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: documents documents_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: email_attachments email_attachments_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_folders email_folders_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_folders
    ADD CONSTRAINT email_folders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: email_folders email_folders_user_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_folders
    ADD CONSTRAINT email_folders_user_account_id_fkey FOREIGN KEY (user_account_id) REFERENCES public.user_email_accounts(id) ON DELETE CASCADE;


--
-- Name: email_sync_log email_sync_log_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sync_log
    ADD CONSTRAINT email_sync_log_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: emails emails_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.email_accounts(id) ON DELETE SET NULL;


--
-- Name: emails emails_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.email_folders(id);


--
-- Name: emails emails_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);


--
-- Name: emails emails_user_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_user_account_id_fkey FOREIGN KEY (user_account_id) REFERENCES public.user_email_accounts(id);


--
-- Name: employee_collection_items employee_collection_items_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collection_items
    ADD CONSTRAINT employee_collection_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: employee_collection_items employee_collection_items_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collection_items
    ADD CONSTRAINT employee_collection_items_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.employee_collections(id) ON DELETE CASCADE;


--
-- Name: employee_collection_items employee_collection_items_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collection_items
    ADD CONSTRAINT employee_collection_items_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_collections employee_collections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_collections
    ADD CONSTRAINT employee_collections_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_permits employee_permits_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_permits
    ADD CONSTRAINT employee_permits_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_plan employee_plan_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_plan
    ADD CONSTRAINT employee_plan_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_plan employee_plan_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_plan
    ADD CONSTRAINT employee_plan_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: employee_rates employee_rates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rates
    ADD CONSTRAINT employee_rates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_rates employee_rates_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rates
    ADD CONSTRAINT employee_rates_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_reviews employee_reviews_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reviews
    ADD CONSTRAINT employee_reviews_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_reviews employee_reviews_pm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reviews
    ADD CONSTRAINT employee_reviews_pm_id_fkey FOREIGN KEY (pm_id) REFERENCES public.users(id);


--
-- Name: employee_reviews employee_reviews_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reviews
    ADD CONSTRAINT employee_reviews_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: employees employees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: equipment_categories equipment_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_categories
    ADD CONSTRAINT equipment_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.equipment_categories(id);


--
-- Name: equipment equipment_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.equipment_categories(id);


--
-- Name: equipment equipment_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: equipment equipment_current_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_current_holder_id_fkey FOREIGN KEY (current_holder_id) REFERENCES public.users(id);


--
-- Name: equipment equipment_current_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_current_object_id_fkey FOREIGN KEY (current_object_id) REFERENCES public.objects(id);


--
-- Name: equipment equipment_kit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_kit_id_fkey FOREIGN KEY (kit_id) REFERENCES public.equipment_kits(id);


--
-- Name: equipment_kit_items equipment_kit_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kit_items
    ADD CONSTRAINT equipment_kit_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.equipment_categories(id);


--
-- Name: equipment_kit_items equipment_kit_items_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kit_items
    ADD CONSTRAINT equipment_kit_items_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE SET NULL;


--
-- Name: equipment_kit_items equipment_kit_items_kit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kit_items
    ADD CONSTRAINT equipment_kit_items_kit_id_fkey FOREIGN KEY (kit_id) REFERENCES public.equipment_kits(id) ON DELETE CASCADE;


--
-- Name: equipment_kits equipment_kits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_kits
    ADD CONSTRAINT equipment_kits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: equipment_maintenance equipment_maintenance_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance
    ADD CONSTRAINT equipment_maintenance_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: equipment_maintenance equipment_maintenance_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_maintenance
    ADD CONSTRAINT equipment_maintenance_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE CASCADE;


--
-- Name: equipment_movements equipment_movements_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: equipment_movements equipment_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: equipment_movements equipment_movements_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE CASCADE;


--
-- Name: equipment_movements equipment_movements_from_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_from_holder_id_fkey FOREIGN KEY (from_holder_id) REFERENCES public.users(id);


--
-- Name: equipment_movements equipment_movements_from_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_from_object_id_fkey FOREIGN KEY (from_object_id) REFERENCES public.objects(id);


--
-- Name: equipment_movements equipment_movements_from_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_from_warehouse_id_fkey FOREIGN KEY (from_warehouse_id) REFERENCES public.warehouses(id);


--
-- Name: equipment_movements equipment_movements_to_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_to_holder_id_fkey FOREIGN KEY (to_holder_id) REFERENCES public.users(id);


--
-- Name: equipment_movements equipment_movements_to_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_to_object_id_fkey FOREIGN KEY (to_object_id) REFERENCES public.objects(id);


--
-- Name: equipment_movements equipment_movements_to_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_movements
    ADD CONSTRAINT equipment_movements_to_warehouse_id_fkey FOREIGN KEY (to_warehouse_id) REFERENCES public.warehouses(id);


--
-- Name: equipment_requests equipment_requests_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_requests
    ADD CONSTRAINT equipment_requests_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id);


--
-- Name: equipment_requests equipment_requests_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_requests
    ADD CONSTRAINT equipment_requests_object_id_fkey FOREIGN KEY (object_id) REFERENCES public.objects(id);


--
-- Name: equipment_requests equipment_requests_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_requests
    ADD CONSTRAINT equipment_requests_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id);


--
-- Name: equipment_requests equipment_requests_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_requests
    ADD CONSTRAINT equipment_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id);


--
-- Name: equipment_requests equipment_requests_target_holder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_requests
    ADD CONSTRAINT equipment_requests_target_holder_id_fkey FOREIGN KEY (target_holder_id) REFERENCES public.users(id);


--
-- Name: equipment_reservations equipment_reservations_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE CASCADE;


--
-- Name: equipment_reservations equipment_reservations_reserved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_reserved_by_fkey FOREIGN KEY (reserved_by) REFERENCES public.users(id);


--
-- Name: equipment equipment_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);


--
-- Name: equipment_work_assignments equipment_work_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_work_assignments
    ADD CONSTRAINT equipment_work_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: equipment_work_assignments equipment_work_assignments_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_work_assignments
    ADD CONSTRAINT equipment_work_assignments_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE CASCADE;


--
-- Name: equipment_work_assignments equipment_work_assignments_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_work_assignments
    ADD CONSTRAINT equipment_work_assignments_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id) ON DELETE CASCADE;


--
-- Name: equipment equipment_written_off_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_written_off_by_fkey FOREIGN KEY (written_off_by) REFERENCES public.users(id);


--
-- Name: erp_field_mappings erp_field_mappings_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_field_mappings
    ADD CONSTRAINT erp_field_mappings_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.erp_connections(id);


--
-- Name: erp_sync_log erp_sync_log_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_sync_log
    ADD CONSTRAINT erp_sync_log_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.erp_connections(id);


--
-- Name: erp_sync_log erp_sync_log_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_sync_log
    ADD CONSTRAINT erp_sync_log_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: estimate_approval_events estimate_approval_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_events
    ADD CONSTRAINT estimate_approval_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: estimate_approval_events estimate_approval_events_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_events
    ADD CONSTRAINT estimate_approval_events_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id) ON DELETE CASCADE;


--
-- Name: estimate_approval_events estimate_approval_events_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_events
    ADD CONSTRAINT estimate_approval_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.estimate_approval_requests(id) ON DELETE CASCADE;


--
-- Name: estimate_approval_requests estimate_approval_requests_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests
    ADD CONSTRAINT estimate_approval_requests_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id) ON DELETE CASCADE;


--
-- Name: estimate_approval_requests estimate_approval_requests_last_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests
    ADD CONSTRAINT estimate_approval_requests_last_actor_id_fkey FOREIGN KEY (last_actor_id) REFERENCES public.users(id);


--
-- Name: estimate_approval_requests estimate_approval_requests_pm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests
    ADD CONSTRAINT estimate_approval_requests_pm_id_fkey FOREIGN KEY (pm_id) REFERENCES public.users(id);


--
-- Name: estimate_approval_requests estimate_approval_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests
    ADD CONSTRAINT estimate_approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: estimate_approval_requests estimate_approval_requests_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_approval_requests
    ADD CONSTRAINT estimate_approval_requests_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE SET NULL;


--
-- Name: estimates estimates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: estimates estimates_pm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_pm_id_fkey FOREIGN KEY (pm_id) REFERENCES public.users(id);


--
-- Name: estimates estimates_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;


--
-- Name: inbox_applications inbox_applications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_applications
    ADD CONSTRAINT inbox_applications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: inbox_applications inbox_applications_decision_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_applications
    ADD CONSTRAINT inbox_applications_decision_by_fkey FOREIGN KEY (decision_by) REFERENCES public.users(id);


--
-- Name: inbox_applications inbox_applications_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_applications
    ADD CONSTRAINT inbox_applications_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE SET NULL;


--
-- Name: inbox_applications inbox_applications_linked_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_applications
    ADD CONSTRAINT inbox_applications_linked_tender_id_fkey FOREIGN KEY (linked_tender_id) REFERENCES public.tenders(id);


--
-- Name: inbox_applications inbox_applications_linked_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_applications
    ADD CONSTRAINT inbox_applications_linked_work_id_fkey FOREIGN KEY (linked_work_id) REFERENCES public.works(id);


--
-- Name: incomes incomes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incomes
    ADD CONSTRAINT incomes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: incomes incomes_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incomes
    ADD CONSTRAINT incomes_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: inventory_checks inventory_checks_conducted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_checks
    ADD CONSTRAINT inventory_checks_conducted_by_fkey FOREIGN KEY (conducted_by) REFERENCES public.users(id);


--
-- Name: inventory_checks inventory_checks_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_checks
    ADD CONSTRAINT inventory_checks_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);


--
-- Name: invoice_payments invoice_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: invoices invoices_act_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_act_id_fkey FOREIGN KEY (act_id) REFERENCES public.acts(id);


--
-- Name: invoices invoices_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id);


--
-- Name: invoices invoices_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: invoices invoices_tkp_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tkp_id_fkey FOREIGN KEY (tkp_id) REFERENCES public.tkp(id);


--
-- Name: meeting_minutes meeting_minutes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: meeting_minutes meeting_minutes_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_minutes meeting_minutes_responsible_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES public.users(id);


--
-- Name: meeting_minutes meeting_minutes_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: meeting_participants meeting_participants_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_participants meeting_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_minutes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_minutes_author_id_fkey FOREIGN KEY (minutes_author_id) REFERENCES public.users(id);


--
-- Name: meetings meetings_organizer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES public.users(id);


--
-- Name: meetings meetings_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: meetings meetings_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: mimir_conversations mimir_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_conversations
    ADD CONSTRAINT mimir_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mimir_messages mimir_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_messages
    ADD CONSTRAINT mimir_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.mimir_conversations(id) ON DELETE CASCADE;


--
-- Name: mimir_usage_log mimir_usage_log_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_usage_log
    ADD CONSTRAINT mimir_usage_log_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.mimir_conversations(id) ON DELETE SET NULL;


--
-- Name: mimir_usage_log mimir_usage_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mimir_usage_log
    ADD CONSTRAINT mimir_usage_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: office_expenses office_expenses_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.office_expenses
    ADD CONSTRAINT office_expenses_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: office_expenses office_expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.office_expenses
    ADD CONSTRAINT office_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: one_time_payments one_time_payments_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_time_payments
    ADD CONSTRAINT one_time_payments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: one_time_payments one_time_payments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_time_payments
    ADD CONSTRAINT one_time_payments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: one_time_payments one_time_payments_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_time_payments
    ADD CONSTRAINT one_time_payments_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: one_time_payments one_time_payments_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_time_payments
    ADD CONSTRAINT one_time_payments_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: pass_requests pass_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pass_requests
    ADD CONSTRAINT pass_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: pass_requests pass_requests_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pass_requests
    ADD CONSTRAINT pass_requests_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: pass_requests pass_requests_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pass_requests
    ADD CONSTRAINT pass_requests_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: payment_registry payment_registry_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_registry
    ADD CONSTRAINT payment_registry_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payment_registry payment_registry_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_registry
    ADD CONSTRAINT payment_registry_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: payment_registry payment_registry_sheet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_registry
    ADD CONSTRAINT payment_registry_sheet_id_fkey FOREIGN KEY (sheet_id) REFERENCES public.payroll_sheets(id);


--
-- Name: payroll_items payroll_items_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: payroll_items payroll_items_sheet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_sheet_id_fkey FOREIGN KEY (sheet_id) REFERENCES public.payroll_sheets(id) ON DELETE CASCADE;


--
-- Name: payroll_items payroll_items_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: payroll_sheets payroll_sheets_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_sheets
    ADD CONSTRAINT payroll_sheets_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: payroll_sheets payroll_sheets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_sheets
    ADD CONSTRAINT payroll_sheets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payroll_sheets payroll_sheets_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_sheets
    ADD CONSTRAINT payroll_sheets_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.users(id);


--
-- Name: payroll_sheets payroll_sheets_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_sheets
    ADD CONSTRAINT payroll_sheets_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: permit_application_history permit_application_history_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_application_history
    ADD CONSTRAINT permit_application_history_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.permit_applications(id) ON DELETE CASCADE;


--
-- Name: permit_application_items permit_application_items_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permit_application_items
    ADD CONSTRAINT permit_application_items_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.permit_applications(id) ON DELETE CASCADE;


--
-- Name: platform_parse_results platform_parse_results_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_parse_results
    ADD CONSTRAINT platform_parse_results_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id);


--
-- Name: pre_tender_requests pre_tender_requests_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tender_requests
    ADD CONSTRAINT pre_tender_requests_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: pre_tender_requests pre_tender_requests_decision_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tender_requests
    ADD CONSTRAINT pre_tender_requests_decision_by_fkey FOREIGN KEY (decision_by) REFERENCES public.users(id);


--
-- Name: pre_tender_requests pre_tender_requests_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tender_requests
    ADD CONSTRAINT pre_tender_requests_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE SET NULL;


--
-- Name: reminders reminders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: role_analytics_cache role_analytics_cache_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_analytics_cache
    ADD CONSTRAINT role_analytics_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: self_employed self_employed_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_employed
    ADD CONSTRAINT self_employed_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: site_inspections site_inspections_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_inspections
    ADD CONSTRAINT site_inspections_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: site_inspections site_inspections_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_inspections
    ADD CONSTRAINT site_inspections_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id) ON DELETE SET NULL;


--
-- Name: site_inspections site_inspections_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_inspections
    ADD CONSTRAINT site_inspections_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE SET NULL;


--
-- Name: site_inspections site_inspections_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_inspections
    ADD CONSTRAINT site_inspections_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id) ON DELETE SET NULL;


--
-- Name: sites sites_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: task_comments task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_comments task_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: task_watchers task_watchers_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watchers
    ADD CONSTRAINT task_watchers_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_watchers task_watchers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_watchers
    ADD CONSTRAINT task_watchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: tasks tasks_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id);


--
-- Name: tasks tasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id);


--
-- Name: tasks tasks_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: tasks tasks_parent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id);


--
-- Name: tasks tasks_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: tasks tasks_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: telephony_escalations telephony_escalations_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_escalations
    ADD CONSTRAINT telephony_escalations_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.call_history(id);


--
-- Name: telephony_escalations telephony_escalations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_escalations
    ADD CONSTRAINT telephony_escalations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: telephony_jobs telephony_jobs_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telephony_jobs
    ADD CONSTRAINT telephony_jobs_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.call_history(id);


--
-- Name: tenders tenders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenders
    ADD CONSTRAINT tenders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: tenders tenders_responsible_pm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenders
    ADD CONSTRAINT tenders_responsible_pm_id_fkey FOREIGN KEY (responsible_pm_id) REFERENCES public.users(id);


--
-- Name: tenders tenders_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenders
    ADD CONSTRAINT tenders_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: tkp tkp_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp
    ADD CONSTRAINT tkp_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: tkp tkp_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp
    ADD CONSTRAINT tkp_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: tkp tkp_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp
    ADD CONSTRAINT tkp_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id);


--
-- Name: tkp tkp_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp
    ADD CONSTRAINT tkp_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: tkp tkp_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp
    ADD CONSTRAINT tkp_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: tkp tkp_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tkp
    ADD CONSTRAINT tkp_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id) ON DELETE SET NULL;


--
-- Name: tmc_requests tmc_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tmc_requests
    ADD CONSTRAINT tmc_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: tmc_requests tmc_requests_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tmc_requests
    ADD CONSTRAINT tmc_requests_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: tmc_requests tmc_requests_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tmc_requests
    ADD CONSTRAINT tmc_requests_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- Name: todo_items todo_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todo_items
    ADD CONSTRAINT todo_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: training_applications training_applications_approved_by_dir_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications
    ADD CONSTRAINT training_applications_approved_by_dir_fkey FOREIGN KEY (approved_by_dir) REFERENCES public.users(id);


--
-- Name: training_applications training_applications_approved_by_head_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications
    ADD CONSTRAINT training_applications_approved_by_head_fkey FOREIGN KEY (approved_by_head) REFERENCES public.users(id);


--
-- Name: training_applications training_applications_completed_by_hr_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications
    ADD CONSTRAINT training_applications_completed_by_hr_fkey FOREIGN KEY (completed_by_hr) REFERENCES public.users(id);


--
-- Name: training_applications training_applications_paid_by_buh_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications
    ADD CONSTRAINT training_applications_paid_by_buh_fkey FOREIGN KEY (paid_by_buh) REFERENCES public.users(id);


--
-- Name: training_applications training_applications_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications
    ADD CONSTRAINT training_applications_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id);


--
-- Name: training_applications training_applications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_applications
    ADD CONSTRAINT training_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: travel_expenses travel_expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travel_expenses
    ADD CONSTRAINT travel_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: travel_expenses travel_expenses_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travel_expenses
    ADD CONSTRAINT travel_expenses_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: travel_expenses travel_expenses_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travel_expenses
    ADD CONSTRAINT travel_expenses_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id);


--
-- Name: user_email_accounts user_email_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_accounts
    ADD CONSTRAINT user_email_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_menu_settings user_menu_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_menu_settings
    ADD CONSTRAINT user_menu_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_requests user_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_requests
    ADD CONSTRAINT user_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: user_requests user_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_requests
    ADD CONSTRAINT user_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: warehouses warehouses_responsible_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.users(id);


--
-- Name: work_expenses work_expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_expenses
    ADD CONSTRAINT work_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: work_expenses work_expenses_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_expenses
    ADD CONSTRAINT work_expenses_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id) ON DELETE CASCADE;


--
-- Name: work_permit_requirements work_permit_requirements_work_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_permit_requirements
    ADD CONSTRAINT work_permit_requirements_work_id_fkey FOREIGN KEY (work_id) REFERENCES public.works(id) ON DELETE CASCADE;


--
-- Name: works works_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works
    ADD CONSTRAINT works_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: works works_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works
    ADD CONSTRAINT works_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id);


--
-- Name: works works_pm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works
    ADD CONSTRAINT works_pm_id_fkey FOREIGN KEY (pm_id) REFERENCES public.users(id);


--
-- Name: works works_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works
    ADD CONSTRAINT works_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: works works_tender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.works
    ADD CONSTRAINT works_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);


--
-- PostgreSQL database dump complete
--

\unrestrict TYIU94PYhVwFMUXgQbIamItn2hj5tgp9y4p4mEfdxs9xW4652uZbe0tAh5Z0dzU

