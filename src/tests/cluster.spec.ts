import { Cluster } from '../cluster';

describe('EventArray', () => {
  it('create items for getting later', async () => {
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    await cluster.start();
    const item = await cluster.get();

    expect(item).toEqual('one');
  });

  it('can add get calls prior to starting', async () => {
    const cluster = new Cluster(
      () => Promise.resolve(1),
      1,
    );

    const getter = cluster.get();
    cluster.start();
    const item = await getter;
    expect(item).toEqual(1);
  });

  it('can add multiple get calls prior to starting', async () => {
    let isDone = false;
    const cluster = new Cluster(
      () => Promise.resolve([]),
      2,
    );

    const getOne = cluster.get();
    cluster.get().then(() => isDone = true);
    cluster.start();
    const itemOne = await getOne;
    expect(itemOne).toEqual([]);
    expect(isDone).toEqual(true);
  });

  it('lets previous get calls run, but others not if they can not', async () => {
    let isDone = false;
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    const getOne = cluster.get();
    cluster.get().then(() => isDone = true);
    cluster.start();
    const itemOne = await getOne;
    expect(itemOne).toEqual('one');
    expect(isDone).toEqual(false);
  });

  it('adds listeners when the cluster is empty', async () => {
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    cluster.start();
    // @ts-ignore
    expect(cluster.addListeners.length).toEqual(0);
    const getOne = cluster.get();

    // @ts-ignore
    expect(cluster.addListeners.length).toEqual(1);
    await getOne;

    // @ts-ignore
    expect(cluster.addListeners.length).toEqual(0);
  });

  it('retains items when they are not in use', async () => {
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    // @ts-ignore
    expect(cluster.items.length).toEqual(0);
    await cluster.start();
    // @ts-ignore
    expect(cluster.items.length).toEqual(1);
    await cluster.get();
    // @ts-ignore
    expect(cluster.items.length).toEqual(0);
  });

  it('drains items as they are used', async () => {
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    await cluster.start();
    // @ts-ignore
    expect(cluster.items.length).toEqual(1);
    await cluster.get();
    // @ts-ignore
    expect(cluster.items.length).toEqual(0);
  });

  it('drains listeners as they are used', async () => {
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    cluster.get();
    // @ts-ignore
    expect(cluster.addListeners.length).toEqual(1);
    await cluster.start();
    // @ts-ignore
    expect(cluster.addListeners.length).toEqual(0);
  });

  it('waits until items are added to resolve pending gets', async () => {
    let resolved = false;
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );
    await cluster.start();
    await cluster.get();
    cluster.get().then(() => resolved = true);
    expect(resolved).toBe(false);
    await cluster.create();
    expect(resolved).toBe(true);
  });

  it('works with zero items', async () => {
    let resolved = false;
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      0,
    );
    await cluster.start();
    const held = cluster.get().then(() => resolved = true);
    expect(resolved).toBe(false);
    cluster.create();
    await held;
    expect(resolved).toBe(true);
  });

  it('resolves pending gets, then queues the rest', async () => {
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    await cluster.start();
    // @ts-ignore
    expect(cluster.items.length).toEqual(1);
    await cluster.get();
    // @ts-ignore
    expect(cluster.items.length).toEqual(0);
    const held = cluster.get();
    await cluster.create();
    await held;
    // @ts-ignore
    expect(cluster.items.length).toEqual(0);
  });

  it('adds items to the queue when no gets are being waited on', async () => {
    const cluster = new Cluster(
      () => Promise.resolve('one'),
      1,
    );

    await cluster.start();
    // @ts-ignore
    expect(cluster.items.length).toEqual(1);
    await cluster.create();
    // @ts-ignore
    expect(cluster.items.length).toEqual(2);
    await cluster.get();
    // @ts-ignore
    expect(cluster.items.length).toEqual(1);
    await cluster.get();
    // @ts-ignore
    expect(cluster.items.length).toEqual(0);
  });
});
