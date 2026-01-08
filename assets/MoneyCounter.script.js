import {Object3DComponent, EntityComponentPlugin} from 'threepipe'

/**
 * MoneyCounter - Manages money and displays counter UI
 * Singleton component - attach to GameManager object
 *
 * From PRD:
 * - Position: Top-left corner
 * - Display: "$X" (HTML overlay)
 * - Starting money: $500
 * - City Hall generates +$10/sec baseline
 */
export class MoneyCounter extends Object3DComponent {
    static StateProperties = [
        'money', 'startingMoney', 'cityHallIncomePerSec'
    ]
    static ComponentType = 'MoneyCounter'

    // Economy settings
    money = 100000
    startingMoney = 500
    cityHallIncomePerSec = 10

    // Internal state
    _element = null
    _lastIncomeTime = 0
    _incomeInterval = 1000 // Generate income every second

    start() {
        if (super.start) super.start()

        this.money = this.startingMoney
        this._lastIncomeTime = Date.now()
        this._createUI()
        this._updateUI()
    }

    stop() {
        if (super.stop) super.stop()
        this._removeUI()
    }

    _createUI() {
        this._removeUI()

        this._element = document.createElement('div')
        this._element.style.cssText = `
            position: fixed;
            bottom: 50px;
            right: 50px;
            z-index: 1000;
            pointer-events: none;
            font-family: 'Segoe UI', Arial, sans-serif;
        `

        this._element.innerHTML = `
            <div style="
                background: linear-gradient(135deg, rgba(0,0,0,0.85) 0%, rgba(20,20,30,0.9) 100%);
                color: #FFD166;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 28px;
                font-weight: bold;
                border: 2px solid #FFD166;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
                text-shadow: 0 2px 4px rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <span style="font-size: 24px;">$</span>
                <span id="money-value">${this.money}</span>
            </div>
        `

        const container = this.ctx?.viewer?.container
        if (container) {
            container.appendChild(this._element)
        } else {
            document.body.appendChild(this._element)
        }
    }

    _removeUI() {
        if (this._element) {
            this._element.remove()
            this._element = null
        }
    }

    _updateUI() {
        if (!this._element) return

        const valueEl = this._element.querySelector('#money-value')
        if (valueEl) {
            valueEl.textContent = Math.floor(this.money).toLocaleString()
        }
    }

    /**
     * Add money (from income, selling, etc.)
     */
    addMoney(amount) {
        this.money += amount
        this._updateUI()
        this._flashUI('#44ff44') // Green flash for income
    }

    /**
     * Spend money (returns false if insufficient funds)
     */
    spendMoney(amount) {
        if (this.money < amount) {
            this._flashUI('#ff4444') // Red flash for insufficient
            return false
        }
        this.money -= amount
        this._updateUI()
        return true
    }

    /**
     * Check if can afford
     */
    canAfford(amount) {
        return this.money >= amount
    }

    /**
     * Flash UI for feedback
     */
    _flashUI(color) {
        if (!this._element) return

        const innerDiv = this._element.querySelector('div')
        if (!innerDiv) return

        const originalBorder = innerDiv.style.border
        innerDiv.style.border = `2px solid ${color}`
        innerDiv.style.boxShadow = `0 4px 12px rgba(0,0,0,0.5), 0 0 20px ${color}`

        setTimeout(() => {
            innerDiv.style.border = originalBorder
            innerDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)'
        }, 200)
    }

    /**
     * Check if City Hall exists and generate income
     */
    _generateCityHallIncome() {
        // Find City Hall component
        const cityHall = this.ctx?.ecp?.getComponentOfType?.('CityHall')
        if (!cityHall || !cityHall.isAlive) return

        // Generate income
        this.addMoney(this.cityHallIncomePerSec)
    }

    update({deltaTime}) {
        if (!this.object) return false

        const now = Date.now()

        // Generate City Hall income periodically
        if (now - this._lastIncomeTime >= this._incomeInterval) {
            this._lastIncomeTime = now
            this._generateCityHallIncome()
        }

        return true
    }
}
