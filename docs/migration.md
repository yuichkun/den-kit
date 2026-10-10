# den-kit 試作の移行（GEN-654）

2026-10-10。正式版への作り直しを始める前に、トシがパッチング・エディターの体験を触って考えられる状態を作るための移行。

## 引き継いだもの

- 移行元：`yuichkun/den` の `claude/awesome-darwin-csz4kc`、`d9db3a4ffe3b89279512f4750e2f8cec3b41250c` の `kit/`。
- `git subtree split --prefix=kit` で47コミットを切り出し、den-kitのルートに置いた。作者・作者日時・メッセージ・変更内容を引き継いだ。パスと親の履歴が変わるため、コミットIDは変わる。[全コミットの対応表](migration-history.json)に元と移行後のIDを記録した。
- 移行直後のtreeは移行元の`kit/`のtreeと完全に一致した。以後の独立化の変更は別コミット。
- `.env`・`.codex-home`・`.logs`は作業コピーにも履歴にも持ち込んでいない。移行した履歴878個の固有blobを認証キー・秘密鍵の代表的パターンで走査し、該当なし。旧U2の削除済みコミットを復元していない。
- MIT OR Apache-2.0。denと同じライセンス文を収録した。作品集の素材の出典は`public/showcase/SOURCES.md`。

## 独立化の差分

- `@denaudio/den@0.1.0`・`@unworklet/core@0.4.1`・`@unworklet/offline@0.4.1`を固定依存として追加。Playwrightもden側から借りず、このrepoで固定した。
- ViteとTypeScriptからdenソースへのaliasを除去。ブロック一覧とテストのregistryは、インストールしたdenの公開exportsを読む。workletとcodeboxの型もこのrepoの依存から用意する。
- doctorはnpm版denの版と、den・den-kitが同じunworkletを読むことを確認する。
- 起動・診断・サインイン・Jev評価の案内を、このrepoのコマンドとパスへ変更。関連テストの案内文期待値も対応。作品データ形式は維持。
- npm版denの全exportsをViteで事前最適化し、初回読込後のページ再読込を防止。BrowserPodのHOMEを読む前は`/`から実行し、テストの子プロセス失敗も正しく伝播させる。Mac/Linuxの選択キーとsedの違いをテストで吸収。
- 再現確認で見つかった既存不具合を最小修正：起動後1.5秒以内に矢印でノードを動かしても、一続きの移動を1回のUndoにまとめる。
- 音を起動した最初の鍵盤を取りこぼさないよう、ロード中の押下状態はノードの開始後に再送する。
- `.gitignore`、Node 24の指定、ライセンス、履歴対応表、再現手順、CIを追加。

## 触りはじめる

Node.js 24を用意し、このrepoで実行する。den本体のcloneは不要。

```sh
npm ci
KIT_CODEX=off npm run dev
```

Chromeで <http://127.0.0.1:5180/> を開く。音声は48 kHz。作品集から始め、Patchで音を編集し、PluginのEditで画面を編集できる。保存・読み込み・マイパーツも使える。

AIを使うときは`npm run codex:login`で自分のChatGPTへサインインし、`npm run doctor`で確認する。Jev／BrowserPodも自分のキーを`.env`に設定する。キーがなくても手での制作は動く。秘密・認証・個人のログは共有しない。

## 検証

- macOS・Node 24.21.0で`npm run build`と`npm test`が成功。単体669件、統合272件、ブラウザ89件、計1,030件がすべて通過。
- 統合テストには、npm版denとのbass・percussion・pad・chorus・rhythmic delayの5種類のサンプル単位の一致を含む。
- GitHubから`/private/tmp/den-kit-reproduction`へ新しくcloneし、通常の`npm ci`・ビルド・doctorを確認。den本体の隣接checkoutなしで、ブラウザで48 kHzの演奏、パッチの書き出し・再読込、Patch／Pluginの切替を確認。ブラウザの例外なし。
- 履歴のtree一致・作者と日時・秘密の除外・独立依存・差分を別のエージェントが読み取りレビューし、移行を妨げる指摘なし。
- 独立化の[全差分とCI](https://github.com/yuichkun/den-kit/pull/1)。CIはUbuntuでも新規インストール・ビルド・全テストを実行する。

自動テストではJev・モデル・BrowserPodは模擬。実際のCodexバイナリのプロトコル確認はネットワークなし・未認証で行う。これは外部サービスの認証済み動作や音の承認を代替しない。音はCANDIDATE、denの4-voice runtimeのNOT_CLEAREDを解除しない。

## この移行のあと

[GEN-657](https://linear.app/escentier/issue/GEN-657)で正式版を基本的に作り直す。余湖さんが基本構造・全体の体験設計・エンジニアリングを持ち、そのあとトシがクリエイターとして使いにくいところを直す。細かい担当箇所は固定していない。

移行元ブランチは、このrepoのmainへの保存と再現確認後に削除する。削除の完了証跡は[GEN-654](https://linear.app/escentier/issue/GEN-654)に記録する。移行元の手元にある未追跡ファイルや個人設定は削除しない。
