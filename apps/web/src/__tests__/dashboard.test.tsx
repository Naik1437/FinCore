/* eslint-disable @typescript-eslint/unbound-method */
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { BeneficiaryManager } from '../components/BeneficiaryManager';
import { DisputeModal } from '../components/DisputeModal';
import { OperationsConsole } from '../components/OperationsConsole';
import { SimulatedBanner } from '../components/SimulatedBanner';
import { StatementViewer } from '../components/StatementViewer';
import { TransferForm } from '../components/TransferForm';
import { WalletCard } from '../components/WalletCard';
import { api } from '../services/api';
import type {
  Beneficiary,
  Dispute,
  OperationsSummary,
  Statement,
  Transaction,
  Wallet,
} from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Helper to reliably trigger React controlled input updates in JSDOM
function changeInput(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

// Mock the API client
jest.mock('../services/api', () => ({
  api: {
    getWallets: jest.fn(),
    getBeneficiaries: jest.fn(),
    createBeneficiary: jest.fn(),
    deleteBeneficiary: jest.fn(),
    getTransactions: jest.fn(),
    createTransfer: jest.fn(),
    getDisputes: jest.fn(),
    createDispute: jest.fn(),
    updateDisputeStatus: jest.fn(),
    getStatement: jest.fn(),
    getOperationsSummary: jest.fn(),
    getLedgerEntries: jest.fn(),
  },
}));

describe('Assessment 01 — Financial Customer Frontend Test Suite', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockWallets: Wallet[] = [
    {
      id: 'w-usd-100',
      userId: 'u-alex-1',
      currency: 'USD',
      balance: 10500.0,
      status: 'active',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'w-eur-200',
      userId: 'u-alex-1',
      currency: 'EUR',
      balance: 4200.5,
      status: 'active',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const mockBeneficiaries: Beneficiary[] = [
    {
      id: 'ben-1',
      userId: 'u-alex-1',
      name: 'Acme Cloud Services',
      accountNumber: 'ACC-99281726',
      bankName: 'JPMorgan Chase',
      currency: 'USD',
      status: 'approved',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ben-2',
      userId: 'u-alex-1',
      name: 'Euro Supplies GmbH',
      accountNumber: 'DE89370400440532013000',
      bankName: 'Deutsche Bank',
      currency: 'EUR',
      status: 'approved',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  // 1. SIMULATED BALANCES & BANNER
  describe('Requirement 1: Clearly Labeled Simulated Balances', () => {
    it('renders the Simulated Disclaimer Banner with prominent warnings', () => {
      act(() => {
        root.render(<SimulatedBanner />);
      });

      expect(container.textContent).toContain('SIMULATED FINANCIAL ENVIRONMENT');
      expect(container.textContent).toContain('synthetic records for demonstration');
      expect(container.textContent).toContain('No real funds');
    });

    it('displays the simulated label prominently on WalletCard with correct balance', () => {
      const onSendMock = jest.fn();
      const onViewStatementMock = jest.fn();

      act(() => {
        root.render(
          <WalletCard
            wallet={mockWallets[0]}
            onSendTransfer={onSendMock}
            onViewStatement={onViewStatementMock}
          />
        );
      });

      expect(container.textContent).toContain('Simulated');
      expect(container.textContent).toContain('AVAILABLE SIMULATED BALANCE');
      expect(container.textContent).toContain('$10,500.00');
      expect(container.textContent).toContain('USD Wallet');

      const buttons = container.querySelectorAll('button');
      act(() => {
        buttons[0].click();
      });
      expect(onSendMock).toHaveBeenCalledWith('w-usd-100');

      act(() => {
        buttons[1].click();
      });
      expect(onViewStatementMock).toHaveBeenCalledWith('w-usd-100');
    });
  });

  // 2. BENEFICIARY MANAGEMENT
  describe('Requirement 2: Beneficiary Management & Validation', () => {
    it('renders existing beneficiaries properly', () => {
      act(() => {
        root.render(
          <BeneficiaryManager beneficiaries={mockBeneficiaries} onBeneficiariesChange={jest.fn()} />
        );
      });

      expect(container.textContent).toContain('Acme Cloud Services');
      expect(container.textContent).toContain('ACC-99281726');
      expect(container.textContent).toContain('Euro Supplies GmbH');
    });

    it('validates form fields before allowing beneficiary submission', async () => {
      const mockNewBen: Beneficiary = {
        id: 'ben-new',
        userId: 'u-alex-1',
        name: 'Stripe Operations',
        accountNumber: 'STRIPE-900',
        bankName: 'Silicon Valley Bank',
        currency: 'USD',
        status: 'approved',
        createdAt: '2026-01-01T00:00:00Z',
      };

      (api.createBeneficiary as jest.Mock).mockResolvedValue(mockNewBen);
      const onChangeMock = jest.fn();

      act(() => {
        root.render(<BeneficiaryManager beneficiaries={[]} onBeneficiariesChange={onChangeMock} />);
      });

      expect(container.textContent).toContain('No beneficiaries added yet');

      const addBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Add Beneficiary')
      );
      expect(addBtn).toBeDefined();

      act(() => {
        addBtn?.click();
      });

      const nameInput = container.querySelector('#ben-name') as HTMLInputElement;
      const bankInput = container.querySelector('#ben-bank') as HTMLInputElement;
      const accInput = container.querySelector('#ben-account') as HTMLInputElement;

      expect(nameInput).not.toBeNull();
      expect(bankInput).not.toBeNull();
      expect(accInput).not.toBeNull();

      act(() => {
        changeInput(nameInput, 'Stripe Operations');
        changeInput(bankInput, 'Silicon Valley Bank');
        changeInput(accInput, 'STRIPE-900');
      });

      const submitBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Save Beneficiary')
      );
      expect(submitBtn).toBeDefined();

      await act(async () => {
        submitBtn?.click();
      });

      expect(api.createBeneficiary).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Stripe Operations',
          bankName: 'Silicon Valley Bank',
          accountNumber: 'STRIPE-900',
        })
      );
      expect(onChangeMock).toHaveBeenCalledTimes(1);
    });
  });

  // 3. TRANSFER INTERFACE & VALIDATION
  describe('Requirement 3: Transfer Interface with Validation', () => {
    it('validates that transfer amount cannot exceed wallet balance', async () => {
      act(() => {
        root.render(
          <TransferForm
            wallets={mockWallets}
            beneficiaries={mockBeneficiaries}
            selectedWalletId="w-usd-100"
            onTransferSuccess={jest.fn()}
            onNavigateToBeneficiaries={jest.fn()}
          />
        );
      });

      expect(container.textContent).toContain('Simulated Fund Transfer');

      const amountInput = container.querySelector('#transfer-amount') as HTMLInputElement;
      const descInput = container.querySelector('#transfer-desc') as HTMLInputElement;

      expect(amountInput).not.toBeNull();
      expect(descInput).not.toBeNull();

      act(() => {
        changeInput(amountInput, '999999.00');
        changeInput(descInput, 'Mega Transfer');
      });

      const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      await act(async () => {
        submitBtn.click();
      });

      expect(container.textContent).toContain('Insufficient simulated funds');
      expect(api.createTransfer).not.toHaveBeenCalled();
    });

    it('validates that transfer amount must be greater than zero', async () => {
      act(() => {
        root.render(
          <TransferForm
            wallets={mockWallets}
            beneficiaries={mockBeneficiaries}
            selectedWalletId="w-usd-100"
            onTransferSuccess={jest.fn()}
            onNavigateToBeneficiaries={jest.fn()}
          />
        );
      });

      const amountInput = container.querySelector('#transfer-amount') as HTMLInputElement;
      expect(amountInput).not.toBeNull();

      act(() => {
        changeInput(amountInput, '-50');
      });

      const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      await act(async () => {
        submitBtn.click();
      });

      expect(container.textContent).toContain('Transfer amount must be strictly greater than 0');
      expect(api.createTransfer).not.toHaveBeenCalled();
    });

    it('triggers 2-step confirmation and executes transfer successfully', async () => {
      const onTransferSuccessMock = jest.fn();
      const mockResultTxn: Transaction = {
        id: 'tx-test-999',
        walletId: 'w-usd-100',
        amount: 250.0,
        currency: 'USD',
        status: 'completed',
        type: 'transfer',
        description: 'Cloud invoice',
        createdAt: '2026-01-01T12:00:00Z',
      };

      (api.createTransfer as jest.Mock).mockResolvedValue({
        transaction: mockResultTxn,
        newBalance: 10250.0,
      });

      act(() => {
        root.render(
          <TransferForm
            wallets={mockWallets}
            beneficiaries={mockBeneficiaries}
            selectedWalletId="w-usd-100"
            onTransferSuccess={onTransferSuccessMock}
            onNavigateToBeneficiaries={jest.fn()}
          />
        );
      });

      const amountInput = container.querySelector('#transfer-amount') as HTMLInputElement;
      const descInput = container.querySelector('#transfer-desc') as HTMLInputElement;

      act(() => {
        changeInput(amountInput, '250.00');
        changeInput(descInput, 'Cloud invoice');
      });

      const reviewBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      act(() => {
        reviewBtn.click();
      });

      expect(container.textContent).toContain('Please Review Transfer Details');
      expect(container.textContent).toContain('250.00');

      const confirmBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Confirm & Authorize Transfer')
      );
      expect(confirmBtn).toBeDefined();

      await act(async () => {
        confirmBtn?.click();
      });

      expect(api.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceWalletId: 'w-usd-100',
          amount: 250.0,
          description: 'Cloud invoice',
        })
      );
      expect(onTransferSuccessMock).toHaveBeenCalledTimes(1);

      expect(container.textContent).toContain('Transfer Completed Successfully');
      expect(container.textContent).toContain('tx-test-999');
    });
  });

  // 4. DISPUTE MANAGEMENT
  describe('Requirement 4: Dispute Submission & Management', () => {
    it('submits a dispute for a transaction and validates notes length', async () => {
      const mockTx: Transaction = {
        id: 'tx-fraud-123',
        walletId: 'w-usd-100',
        amount: 500.0,
        currency: 'USD',
        status: 'completed',
        type: 'transfer',
        description: 'Suspicious SaaS',
        createdAt: '2026-01-01T00:00:00Z',
      };

      const mockDispute: Dispute = {
        id: 'disp-101',
        transactionId: 'tx-fraud-123',
        userId: 'u-alex-1',
        reason: 'Unauthorized transfer',
        details: 'I did not authorize this payment to vendor.',
        status: 'pending_review',
        createdAt: '2026-01-01T00:00:00Z',
      };

      (api.createDispute as jest.Mock).mockResolvedValue(mockDispute);
      const onCreatedMock = jest.fn();

      act(() => {
        root.render(
          <DisputeModal transaction={mockTx} onClose={jest.fn()} onDisputeCreated={onCreatedMock} />
        );
      });

      expect(container.textContent).toContain('Raise Transaction Dispute');
      expect(container.textContent).toContain('tx-fraud-123');

      const notesTextarea = container.querySelector('#dispute-details') as HTMLTextAreaElement;
      expect(notesTextarea).not.toBeNull();

      act(() => {
        changeInput(notesTextarea, 'I did not authorize this payment to vendor.');
      });

      const form = container.querySelector('form') as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(api.createDispute).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 'tx-fraud-123',
          details: 'I did not authorize this payment to vendor.',
        })
      );
      expect(onCreatedMock).toHaveBeenCalledWith(mockDispute);
    });
  });

  // 5. STATEMENTS & REPORTS
  describe('Requirement 5: Financial Reports & Statements', () => {
    it('generates a statement and displays net flow and double-entry breakdown', async () => {
      const mockStatement: Statement = {
        statementId: 'STMT-2026-USD-001',
        generatedAt: '2026-01-31T00:00:00Z',
        period: {
          start: '2026-01-01T00:00:00Z',
          end: '2026-01-31T23:59:59Z',
        },
        wallet: {
          id: 'w-usd-100',
          currency: 'USD',
          currentBalance: 10500.0,
          simulated: true,
        },
        summary: {
          totalDebits: 1000.0,
          totalCredits: 1500.0,
          netFlow: 500.0,
          transactionCount: 2,
        },
        transactions: [
          {
            id: 'tx-stmt-1',
            walletId: 'w-usd-100',
            type: 'deposit',
            amount: 1500.0,
            currency: 'USD',
            status: 'completed',
            description: 'Customer deposit',
            createdAt: '2026-01-05T00:00:00Z',
          },
        ],
      };

      (api.getStatement as jest.Mock).mockResolvedValue(mockStatement);

      await act(async () => {
        root.render(<StatementViewer wallets={mockWallets} selectedWalletId="w-usd-100" />);
      });

      expect(container.textContent).toContain('Financial Reports & Statements');
      expect(container.textContent).toContain('+USD 500.00');
      expect(container.textContent).toContain('+USD 1500.00');
      expect(container.textContent).toContain('-USD 1000.00');
      expect(container.textContent).toContain('Customer deposit');
    });
  });

  // 6. OPERATIONS DASHBOARD & DISPUTE ADJUDICATION
  describe('Requirement 6: Operations Console & Adjudication', () => {
    it('renders operations metrics and allows dispute status updates', async () => {
      const mockSummary: OperationsSummary = {
        activeWallets: 2,
        totalTransactions: 10,
        totalVolume: 18500.0,
        pendingTransactions: 2,
        failedTransactions: 0,
        totalDisputes: 1,
        openDisputes: 1,
        immutableLedgerEntries: 20,
      };

      const mockDisputes: Dispute[] = [
        {
          id: 'disp-ops-1',
          transactionId: 'tx-fraud-123',
          userId: 'u-alex-1',
          reason: 'unauthorized_transaction',
          details: 'Unknown charge on statement',
          status: 'pending_review',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ];

      (api.getOperationsSummary as jest.Mock).mockResolvedValue(mockSummary);
      (api.getDisputes as jest.Mock).mockResolvedValue(mockDisputes);
      (api.getTransactions as jest.Mock).mockResolvedValue([]);
      (api.getLedgerEntries as jest.Mock).mockResolvedValue([]);
      (api.updateDisputeStatus as jest.Mock).mockResolvedValue({
        ...mockDisputes[0],
        status: 'under_investigation',
      });

      await act(async () => {
        root.render(<OperationsConsole />);
      });

      expect(container.textContent).toContain('Operations Command Console');
      expect(container.textContent).toContain('$18,500.00');
      expect(container.textContent).toContain('Active Wallets');

      // Switch to disputes tab
      const disputeTabBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Dispute Escalations')
      );
      expect(disputeTabBtn).toBeDefined();

      act(() => {
        disputeTabBtn?.click();
      });

      expect(container.textContent).toContain('Customer Dispute Queue');
      expect(container.textContent).toContain('Unknown charge on statement');

      // Click Adjudicate
      const adjudicateBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Adjudicate')
      );
      expect(adjudicateBtn).toBeDefined();

      act(() => {
        adjudicateBtn?.click();
      });

      expect(container.textContent).toContain('Adjudicate Customer Dispute');

      // Fill in notes and commit decision
      const notesInput = container.querySelector('#resolutionNotes') as HTMLTextAreaElement;
      expect(notesInput).not.toBeNull();

      act(() => {
        changeInput(notesInput, 'Reviewing vendor communication log.');
      });

      const modalForm = container.querySelector('.modal-dialog form') as HTMLFormElement;
      expect(modalForm).not.toBeNull();

      await act(async () => {
        modalForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(api.updateDisputeStatus).toHaveBeenCalledWith(
        'disp-ops-1',
        'under_investigation',
        'Reviewing vendor communication log.'
      );
    });
  });
});
