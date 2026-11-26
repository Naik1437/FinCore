import { test, expect } from '@playwright/test';

test.describe('FinCore End-to-End User Journeys', () => {
  test('1. Landing page displays simulated environment banners and header branding', async ({ page }) => {
    await page.goto('/');

    // Check Simulated banner
    const banner = page.locator('aside[aria-label="Simulation Environment Notice"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('SIMULATED FINANCIAL ENVIRONMENT:');

    // Check Header branding
    const brand = page.locator('header').getByText('FinCore', { exact: true });
    await expect(brand).toBeVisible();

    const simulatedBadge = page.locator('.simulated-badge').first();
    await expect(simulatedBadge).toBeVisible();
    await expect(simulatedBadge).toHaveText('Simulated');
  });

  test('2. Navigation tabs and role switching between Customer View and Operations Console', async ({ page }) => {
    await page.goto('/');

    // Verify initial Customer persona
    const customerRoleBtn = page.getByRole('radio', { name: /Customer View/i });
    const operationsRoleBtn = page.getByRole('radio', { name: /Operations Console/i });

    await expect(customerRoleBtn).toBeVisible();
    await expect(operationsRoleBtn).toBeVisible();

    // Switch to Operations Console
    await operationsRoleBtn.click();
    await expect(page.getByText('Operations Command Console', { exact: false })).toBeVisible();

    // Switch back to Customer View
    await customerRoleBtn.click();
    await expect(page.getByText('Simulated Multi-Currency Wallets', { exact: false })).toBeVisible();
  });

  test('3. Auth modal can be opened and contains role presets', async ({ page }) => {
    await page.goto('/');

    // Open Auth Modal
    const authBtn = page.locator('header').getByRole('button', { name: /Sign In|Switch Role/i });
    await expect(authBtn).toBeVisible();
    await authBtn.click();

    // Verify Auth Modal is open
    const modalHeading = page.locator('#auth-modal-title');
    await expect(modalHeading).toBeVisible();
    await expect(modalHeading).toContainText('Financial Identity & Authorization');

    // Verify Quick Role buttons exist
    await expect(page.getByRole('button', { name: /Customer/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Operations Analyst/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Finance Admin/i }).first()).toBeVisible();

    // Close modal
    const closeBtn = page.getByRole('button', { name: '✕' });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();
  });

  test('4. Customer navigation tabs switch views properly', async ({ page }) => {
    await page.goto('/');

    // Navigate to Send Funds / Transfers
    const sendFundsTab = page.locator('nav[aria-label="Customer Navigation"]').getByRole('button', { name: /Send Funds/i });
    await expect(sendFundsTab).toBeVisible();
    await sendFundsTab.click();
    await expect(page.getByText('Simulated Fund Transfer', { exact: false })).toBeVisible();

    // Navigate to History & Transactions
    const historyTab = page.locator('nav[aria-label="Customer Navigation"]').getByRole('button', { name: /History & Transactions/i });
    await expect(historyTab).toBeVisible();
    await historyTab.click();
    await expect(page.getByText('Transaction History & States', { exact: false })).toBeVisible();

    // Navigate to Beneficiaries
    const benTab = page.locator('nav[aria-label="Customer Navigation"]').getByRole('button', { name: /Beneficiaries/i });
    await expect(benTab).toBeVisible();
    await benTab.click();
    await expect(page.getByText('Saved Beneficiaries', { exact: false })).toBeVisible();

    // Navigate to Statements
    const stmtTab = page.locator('nav[aria-label="Customer Navigation"]').getByRole('button', { name: /Statements & Reports/i });
    await expect(stmtTab).toBeVisible();
    await stmtTab.click();
    await expect(page.getByText('Financial Reports & Statements', { exact: false })).toBeVisible();
  });

  test('5. Actual browser login-to-transfer customer journey', async ({ page }) => {
    await page.goto('/');

    // 1. Open Auth Modal
    const authBtn = page.locator('header').getByRole('button', { name: /Sign In|Switch Role/i });
    await authBtn.click();

    // 2. Select Customer preset
    const customerPresetBtn = page.getByRole('button', { name: /Customer/i }).first();
    await expect(customerPresetBtn).toBeVisible();
    await customerPresetBtn.click();

    // 3. Submit Login
    const submitLoginBtn = page.getByRole('button', { name: /Sign In with JWT/i });
    await expect(submitLoginBtn).toBeVisible();
    await submitLoginBtn.click();

    // 4. Verify authenticated session
    await expect(page.locator('#auth-modal-title')).not.toBeVisible();
    await expect(page.locator('header').getByText(/Customer|Alex Morgan/i).first()).toBeVisible();

    // 5. Ensure approved beneficiary exists for transfer
    const benNavTab = page.locator('nav[aria-label="Customer Navigation"]').getByRole('button', { name: /Beneficiaries/i });
    await benNavTab.click();
    await page.waitForTimeout(500);

    const existingBen = page.locator('.beneficiary-card');
    if (await existingBen.count() === 0) {
      const addBenBtn = page.getByRole('button', { name: /Add Beneficiary/i }).first();
      await addBenBtn.click();
      await page.locator('#ben-name').fill('Global Acme Supplier');
      await page.locator('#ben-bank').fill('FinCore Settlement Bank');
      await page.locator('#ben-account').fill('US9876543210');
      await page.getByRole('button', { name: /Save Beneficiary/i }).click();
      await expect(page.locator('#modal-add-beneficiary')).not.toBeVisible();
    }

    // 6. Navigate to Send Funds tab
    const sendFundsTab = page.locator('nav[aria-label="Customer Navigation"]').getByRole('button', { name: /Send Funds/i });
    await sendFundsTab.click();

    // 7. Fill transfer details
    const sourceSelect = page.locator('#source-wallet');
    await expect(sourceSelect).toBeVisible();
    const options = await sourceSelect.locator('option').all();
    if (options.length > 0) {
      const firstVal = await options[0].getAttribute('value');
      if (firstVal) {
        await sourceSelect.selectOption(firstVal);
      }
    }

    const amountInput = page.locator('#transfer-amount');
    await expect(amountInput).toBeVisible();
    await amountInput.fill('10.00');

    const descInput = page.locator('#transfer-desc');
    await descInput.fill('E2E Browser Transfer Verification');

    // 8. Proceed to Review
    const reviewBtn = page.getByRole('button', { name: /Review & Confirm Transfer/i });
    await expect(reviewBtn).toBeEnabled();
    await reviewBtn.click();

    // 8. Confirm & Authorize
    const confirmBtn = page.getByRole('button', { name: /Confirm & Authorize Transfer/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 9. Verify Transfer Success receipt modal
    const receiptHeading = page.locator('#receipt-title');
    await expect(receiptHeading).toBeVisible();
    await expect(receiptHeading).toContainText('Transfer Completed Successfully');

    // 10. Close receipt modal
    const closeReceiptBtn = page.getByRole('button', { name: /Close Receipt/i });
    await closeReceiptBtn.click();
    await expect(receiptHeading).not.toBeVisible();

    // 11. Verify navigated to Transaction History and transaction is listed
    await expect(page.getByText('E2E Browser Transfer Verification', { exact: false }).first()).toBeVisible();
  });
});
