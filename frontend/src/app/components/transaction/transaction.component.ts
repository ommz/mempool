import { Component, OnInit, OnDestroy } from '@angular/core';
import { ElectrsApiService } from '../../services/electrs-api.service';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { switchMap, filter, take } from 'rxjs/operators';
import { Transaction, Block } from '../../interfaces/electrs.interface';
import { of, merge } from 'rxjs';
import { StateService } from '../../services/state.service';
import { WebsocketService } from '../../services/websocket.service';
import { AudioService } from 'src/app/services/audio.service';
import { ApiService } from 'src/app/services/api.service';
import { SeoService } from 'src/app/services/seo.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-transaction',
  templateUrl: './transaction.component.html',
  styleUrls: ['./transaction.component.scss']
})
export class TransactionComponent implements OnInit, OnDestroy {
  network = environment.network;
  tx: Transaction;
  txId: string;
  feeRating: number;
  overpaidTimes: number;
  medianFeeNeeded: number;
  txInBlockIndex: number;
  isLoadingTx = true;
  error: any = undefined;
  latestBlock: Block;
  transactionTime = -1;

  rightPosition = 0;

  constructor(
    private route: ActivatedRoute,
    private electrsApiService: ElectrsApiService,
    private stateService: StateService,
    private websocketService: WebsocketService,
    private audioService: AudioService,
    private apiService: ApiService,
    private seoService: SeoService,
  ) { }

  ngOnInit() {
    this.route.paramMap.pipe(
      switchMap((params: ParamMap) => {
        this.txId = params.get('id') || '';
        this.seoService.setTitle('Transaction: ' + this.txId);
        this.error = undefined;
        this.feeRating = undefined;
        this.isLoadingTx = true;
        this.transactionTime = -1;
        document.body.scrollTo(0, 0);
        return merge(
          of(true),
          this.stateService.connectionState$
            .pipe(filter((state) => state === 2 && this.tx && !this.tx.status.confirmed) ),
        )
        .pipe(
          switchMap(() => {
            if (history.state.data) {
              return of(history.state.data);
            }
            return this.electrsApiService.getTransaction$(this.txId);
          })
        );
      })
    )
    .subscribe((tx: Transaction) => {
      this.tx = tx;
      this.isLoadingTx = false;
      this.setMempoolBlocksSubscription();

      if (!tx.status.confirmed) {
        this.websocketService.startTrackTransaction(tx.txid);
        this.getTransactionTime();
      } else {
        this.findBlockAndSetFeeRating();
      }
      if (this.tx.status.confirmed) {
        this.stateService.markBlock$.next({ blockHeight: tx.status.block_height });
      } else {
        this.stateService.markBlock$.next({ txFeePerVSize: tx.fee / (tx.weight / 4) });
      }
    },
    (error) => {
      this.error = error;
      this.isLoadingTx = false;
    });

    this.stateService.blocks$
      .subscribe((block) => this.latestBlock = block);

    this.stateService.txConfirmed$
      .subscribe((block) => {
        this.tx.status = {
          confirmed: true,
          block_height: block.height,
          block_hash: block.id,
          block_time: block.timestamp,
        };
        this.stateService.markBlock$.next({ blockHeight: block.height });
        this.audioService.playSound('magic');
        this.findBlockAndSetFeeRating();
      });
  }

  setMempoolBlocksSubscription() {
    this.stateService.mempoolBlocks$
      .subscribe((mempoolBlocks) => {
        if (!this.tx) {
          return;
        }

        const txFeePerVSize = this.tx.fee / (this.tx.weight / 4);

        for (const block of mempoolBlocks) {
          for (let i = 0; i < block.feeRange.length - 1; i++) {
            if (txFeePerVSize <= block.feeRange[i + 1] && txFeePerVSize >= block.feeRange[i]) {
              this.txInBlockIndex = mempoolBlocks.indexOf(block);
            }
          }
        }
      });
  }

  getTransactionTime() {
    this.apiService.getTransactionTimes$([this.tx.txid])
      .subscribe((transactionTimes) => {
        this.transactionTime = transactionTimes[0];
      });
  }

  findBlockAndSetFeeRating() {
    this.stateService.blocks$
      .pipe(
        filter((block) => block.height === this.tx.status.block_height),
        take(1)
      )
      .subscribe((block) => {
        const feePervByte = this.tx.fee / (this.tx.weight / 4);
        this.medianFeeNeeded = Math.round(block.feeRange[Math.round(block.feeRange.length * 0.5)]);

        // Block not filled
        if (block.weight < 4000000 * 0.95) {
          this.medianFeeNeeded = 1;
        }

        this.overpaidTimes = Math.round(feePervByte / this.medianFeeNeeded);

        if (feePervByte < 0.9) {
          this.feeRating = 0;
        } else if (feePervByte <= this.medianFeeNeeded || this.overpaidTimes < 2) {
          this.feeRating = 1;
        } else {
          this.feeRating = 2;
          if (this.overpaidTimes > 10) {
            this.feeRating = 3;
          }
        }
      });
  }

  ngOnDestroy() {
    this.websocketService.startTrackTransaction('stop');
    this.stateService.markBlock$.next({});
  }
}
