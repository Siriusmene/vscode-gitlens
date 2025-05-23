import './timeline.scss';
import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils';
import type { Period, State } from '../../../plus/timeline/protocol';
import { OpenDataPointCommand, UpdatePeriodCommand } from '../../../plus/timeline/protocol';
import { GlApp } from '../../shared/app';
import type { HostIpc } from '../../shared/ipc';
import type { DataPointClickEventDetail, GlTimelineChart } from './components/chart';
import { TimelineStateProvider } from './stateProvider';
import { timelineBaseStyles, timelineStyles } from './timeline.css';
import './components/chart';
import '../../shared/components/feature-gate';
import '../../shared/components/feature-badge';
import '../../shared/components/code-icon';
import '../../shared/components/progress';

@customElement('gl-timeline-app')
export class GlTimelineApp extends GlApp<State> {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [timelineBaseStyles, timelineStyles];

	@query('#chart')
	private _chart?: GlTimelineChart;

	protected override createStateProvider(state: State, ipc: HostIpc): TimelineStateProvider {
		return new TimelineStateProvider(this, state, ipc);
	}
	protected override onPersistState(state: State): void {
		this._ipc.setPersistedState({ period: state.period, uri: state.uri });
	}

	override connectedCallback(): void {
		super.connectedCallback();

		document.addEventListener('keydown', this.onDocumentKeyDown);
	}

	override disconnectedCallback(): void {
		document.removeEventListener('keydown', this.onDocumentKeyDown);

		super.disconnectedCallback();
	}

	get allowed(): boolean | 'mixed' {
		return this.state.access?.allowed ?? false;
	}

	get header(): { title: string; description: string } {
		let title = this.state.title;
		let description;

		if (title != null) {
			const index = title.lastIndexOf('/');
			if (index >= 0) {
				const name = title.substring(index + 1);
				description = title.substring(0, index);
				title = name;
			}
		}

		return { title: title ?? '', description: description ?? '' };
	}

	@state()
	private _loading = true;
	get loading(): boolean {
		return this.state.dataset != null && this.uri != null && this._loading;
	}

	get period(): Period {
		return this.state.period;
	}

	get subscription(): State['access']['subscription']['current'] | undefined {
		return this.state.access?.subscription?.current;
	}

	get sha(): string | undefined {
		return this.state.sha;
	}

	get uri(): string | undefined {
		return this.state.uri;
	}

	get uriType(): State['uriType'] {
		return this.state.uriType;
	}

	@state()
	private _zoomed = false;
	get zoomed(): boolean {
		return this._zoomed;
	}

	protected override willUpdate(changedProperties: PropertyValues): void {
		if (!changedProperties.has('_loading') && !changedProperties.has('_zoomed')) {
			this._loading = Boolean(this.state.dataset && this.uri);
		}

		super.willUpdate(changedProperties);
	}

	override render(): unknown {
		return html`
			${this.allowed
				? html`<gl-feature-gate
						.source=${{ source: 'timeline' as const, detail: 'gate' }}
						.state=${this.subscription?.state}
				  ></gl-feature-gate>`
				: nothing}
			<div class="container">
				<progress-indicator ?active=${this.loading}></progress-indicator>
				<header class="header" ?hidden=${!this.uri}>
					<span class="details">
						<span class="details__title"
							><code-icon icon="${this.uriType === 'folder' ? 'folder' : 'file'}"></code-icon
							>&nbsp;&nbsp;${this.header.title}</span
						>
						<span class="details__description">${this.header.description}</span>
						<span class="details__sha">
							${this.sha
								? html`<code-icon icon="git-commit" size="16"></code-icon
										><span class="sha">${this.sha}</span>`
								: nothing}
						</span>
					</span>
					<span class="toolbox">
						${this.zoomed
							? html`<gl-button
									appearance="toolbar"
									@click=${(e: MouseEvent) =>
										e.shiftKey || e.altKey ? this._chart?.reset() : this._chart?.zoom(-1)}
									aria-label="Zoom Out"
							  >
									<code-icon icon="zoom-out"></code-icon>
									<span slot="tooltip">Zoom Out<br />[Alt] Reset Zoom</span>
							  </gl-button>`
							: nothing}
						<gl-button
							appearance="toolbar"
							@click=${() => this._chart?.zoom(0.5)}
							tooltip="Zoom In"
							aria-label="Zoom In"
						>
							<code-icon icon="zoom-in"></code-icon>
						</gl-button>
						<span class="select-container">
							<label for="periods">Timeframe</label>
							<select
								class="period"
								name="periods"
								position="below"
								.value=${this.period}
								@change=${this.onPeriodChanged}
							>
								<option value="7|D" ?selected=${this.period === '7|D'}>1 week</option>
								<option value="1|M" ?selected=${this.period === '1|M'}>1 month</option>
								<option value="3|M" ?selected=${this.period === '3|M'}>3 months</option>
								<option value="6|M" ?selected=${this.period === '6|M'}>6 months</option>
								<option value="9|M" ?selected=${this.period === '9|M'}>9 months</option>
								<option value="1|Y" ?selected=${this.period === '1|Y'}>1 year</option>
								<option value="2|Y" ?selected=${this.period === '2|Y'}>2 years</option>
								<option value="4|Y" ?selected=${this.period === '4|Y'}>4 years</option>
								<option value="all" ?selected=${this.period === 'all'}>Full history</option>
							</select>
						</span>
						${this.placement === 'view'
							? html`<gl-button
									appearance="toolbar"
									href="command:gitlens.views.timeline.openInTab"
									tooltip="Open in Editor"
									aria-label="Open in Editor"
							  >
									<code-icon icon="link-external"></code-icon>
							  </gl-button>`
							: nothing}
						${this.subscription == null || !isSubscriptionPaid(this.subscription)
							? html`<gl-feature-badge
									placement="bottom"
									.source=${{ source: 'timeline' as const, detail: 'badge' }}
									.subscription=${this.subscription}
							  ></gl-feature-badge>`
							: nothing}
					</span>
				</header>

				<main class="timeline">${this.renderChart()}</main>
			</div>
		`;
	}

	private renderChart() {
		if (!this.uri || !this.state.dataset) {
			return html`<div class="timeline__empty">
				<p>There are no editors open that can provide file history information.</p>
			</div>`;
		}

		return html`<gl-timeline-chart
			id="chart"
			placement="${this.placement}"
			dateFormat="${this.state.dateFormat}"
			shortDateFormat="${this.state.shortDateFormat}"
			.dataPromise=${this.state.dataset}
			@gl-data-point-click=${this.onChartDataPointClicked}
			@gl-load=${() => (this._loading = false)}
			@gl-zoomed=${(e: CustomEvent<boolean>) => (this._zoomed = e.detail)}
		>
		</gl-timeline-chart>`;
	}

	private onChartDataPointClicked(e: CustomEvent<DataPointClickEventDetail>) {
		this._ipc.sendCommand(OpenDataPointCommand, e.detail);
	}

	private onDocumentKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape' || e.key === 'Esc') {
			this._chart?.reset();
		}
	};

	private onPeriodChanged(e: Event) {
		const element = e.target as HTMLSelectElement;
		const value = element.options[element.selectedIndex].value;
		assertPeriod(value);

		// this.log(`onPeriodChanged(): name=${element.name}, value=${value}`);

		this._ipc.sendCommand(UpdatePeriodCommand, { period: value });
	}
}

function assertPeriod(period: string): asserts period is Period {
	if (period === 'all') return;

	const [value, unit] = period.split('|');
	if (isNaN(Number(value)) || (unit !== 'D' && unit !== 'M' && unit !== 'Y')) {
		throw new Error(`Invalid period: ${period}`);
	}
}
