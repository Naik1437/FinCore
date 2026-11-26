-- Enforce new postings without rewriting historical transactions.
CREATE OR REPLACE FUNCTION verify_journal_posting()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    journal_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'transactions' THEN
        IF NEW.status <> 'completed' THEN
            RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
            RETURN NEW;
        END IF;
        journal_id := NEW.id;
    ELSE
        journal_id := NEW.transaction_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = journal_id)
       OR EXISTS (
          SELECT 1 FROM ledger_entries WHERE transaction_id = journal_id
          GROUP BY currency
          HAVING sum(CASE entry_type WHEN 'debit' THEN amount ELSE -amount END) <> 0
       ) THEN
        RAISE EXCEPTION 'Transaction requires balanced journal entries' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verify_new_completed_transaction ON transactions;
CREATE CONSTRAINT TRIGGER verify_new_completed_transaction
AFTER INSERT OR UPDATE OF status ON transactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_journal_posting();

DROP TRIGGER IF EXISTS verify_inserted_journal ON ledger_entries;
CREATE CONSTRAINT TRIGGER verify_inserted_journal
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_journal_posting();
